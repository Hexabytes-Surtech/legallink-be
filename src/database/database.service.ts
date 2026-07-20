import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult } from 'pg';

const MAX_RETRIES = 3;
const BACKOFF_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Transient = the connection died (Neon suspended the compute / dropped an idle
 * socket / network blip), NOT a real query error. These are safe to retry: a dropped
 * connection means nothing committed. Business errors (e.g. 23505 unique violation)
 * are NOT transient and must surface immediately so callers can handle them.
 */
function isTransientDbError(err: any): boolean {
  const codes = new Set([
    'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED', 'ENOTFOUND',
    '57P01' /* admin shutdown */, '08006', '08001', '08003' /* connection exceptions */,
  ]);
  const check = (e: any): boolean => {
    if (!e) return false;
    if (e.code && codes.has(e.code)) return true;
    const m = String(e.message || '');
    if (/connection terminated|terminating connection|timeout exceeded|server closed the connection|ECONNRESET|ETIMEDOUT|Connection terminated unexpectedly/i.test(m)) {
      return true;
    }
    if (Array.isArray(e.errors)) return e.errors.some(check); // AggregateError (e.g. ETIMEDOUT)
    return false;
  };
  return check(err);
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: { rejectUnauthorized: false },
      // Neon-friendly tuning: keep sockets alive, fail a hung connect fast (so the
      // retry kicks in instead of the request hanging), recycle idle clients before
      // Neon drops them.
      keepAlive: true,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });

    // CRITICAL: without this, an error on an idle pooled client (Neon closing a
    // dropped connection) is emitted as an unhandled 'error' on the pool and can
    // crash the whole process. Log and swallow — the pool removes the bad client.
    this.pool.on('error', (err) => {
      this.logger.warn(`Idle pg client error (recovered): ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.pool.end().catch(() => {});
  }

  /** Single query with transparent retry on transient connection failures. */
  async query(query: string, params?: any[]): Promise<QueryResult> {
    return this.withRetry(() => this.pool.query(query, params), `query`);
  }

  /**
   * Run a callback inside a BEGIN/COMMIT block on a dedicated client.
   * Rolls back automatically on throw. Retries the WHOLE transaction on a transient
   * connection failure — safe because a dropped connection can't have committed.
   */
  async withTransaction<T>(
    fn: (q: (text: string, params?: any[]) => Promise<QueryResult>) => Promise<T>,
  ): Promise<T> {
    return this.withRetry(async () => {
      const client: PoolClient = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const q = (text: string, params?: any[]) => client.query(text, params);
        const result = await fn(q);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch { /* swallow */ }
        throw err;
      } finally {
        client.release();
      }
    }, 'transaction');
  }

  private async withRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
    let lastErr: any;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await op();
      } catch (err) {
        lastErr = err;
        if (!isTransientDbError(err) || attempt === MAX_RETRIES) throw err;
        this.logger.warn(
          `Transient DB error on ${label} (attempt ${attempt}/${MAX_RETRIES}), retrying: ${(err as Error).message}`,
        );
        await sleep(BACKOFF_MS * attempt);
      }
    }
    throw lastErr;
  }
}
