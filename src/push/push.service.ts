import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { DatabaseService } from '../database/database.service';

/** Payload delivered to the service worker's `push` event for an incoming call. */
export interface IncomingCallPush {
  type: 'incoming-call';
  callId: string;
  consultationId: string;
  mode: 'video' | 'voice';
  fromName: string;
  fromAvatar: string | null;
}

interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Web Push (VAPID) sender + subscription store. Mirrors the IceService pattern: if
 * the VAPID env vars are missing the feature is simply disabled (logged once), so
 * the rest of the app — and local dev without keys — keeps working.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;
  private publicKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:admin@legallink.app';
    if (publicKey && privateKey) {
      try {
        webpush.setVapidDetails(subject, publicKey, privateKey);
        this.publicKey = publicKey;
        this.enabled = true;
        this.logger.log('Web Push enabled (VAPID configured).');
      } catch (err) {
        // Bad/malformed keys must not crash boot — just disable push.
        this.logger.error(`Web Push disabled — invalid VAPID keys: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('Web Push disabled — VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set.');
    }
  }

  getPublicKey(): string {
    return this.publicKey;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Upsert one browser subscription for a user (one row per endpoint). */
  async saveSubscription(
    userId: string,
    sub: BrowserSubscription,
    userAgent?: string,
  ): Promise<void> {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return;
    await this.db.query(
      `INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent)
         VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth,
             user_agent = EXCLUDED.user_agent,
             updated_at = now()`,
      [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent ?? null],
    );
  }

  async removeSubscription(endpoint: string): Promise<void> {
    if (!endpoint) return;
    await this.db.query(`DELETE FROM push_subscription WHERE endpoint = $1`, [endpoint]);
  }

  /**
   * Send a push to every device a user has registered. Best-effort: dead endpoints
   * (404/410) are pruned, other failures are logged and swallowed. Never throws, so
   * a push problem can never break the call signaling that triggered it.
   */
  async sendToUser(userId: string, payload: IncomingCallPush): Promise<void> {
    if (!this.enabled) return;

    let rows: { endpoint: string; p256dh: string; auth: string }[] = [];
    try {
      const res = await this.db.query(
        `SELECT endpoint, p256dh, auth FROM push_subscription WHERE user_id = $1`,
        [userId],
      );
      rows = res.rows as typeof rows;
    } catch (err) {
      this.logger.warn(`push lookup failed: ${(err as Error).message}`);
      return;
    }
    if (rows.length === 0) return;

    const body = JSON.stringify(payload);
    await Promise.all(
      rows.map(async (row) => {
        const subscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };
        try {
          await webpush.sendNotification(subscription, body, { TTL: 60, urgency: 'high' });
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.removeSubscription(row.endpoint).catch(() => {});
          } else {
            this.logger.warn(`push send failed (${status ?? '?'}): ${(err as Error).message}`);
          }
        }
      }),
    );
  }
}
