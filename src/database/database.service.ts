import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

@Injectable()
export class DatabaseService {
  private pool: Pool;

  constructor(private configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.get<string>('DATABASE_URL'),
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  async query(query: string, params?: any[]) {
    return this.pool.query(query, params);
  }

  /**
   * Run a callback inside a BEGIN/COMMIT block on a dedicated client.
   * Rolls back automatically on throw. The callback receives a thin `query`
   * binding so call-sites need no awareness of the underlying pg client.
   */
  async withTransaction<T>(
    fn: (q: (text: string, params?: any[]) => Promise<import('pg').QueryResult>) => Promise<T>,
  ): Promise<T> {
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
  }
}
