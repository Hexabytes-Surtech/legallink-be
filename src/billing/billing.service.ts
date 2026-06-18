import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type Razorpay from 'razorpay';
import { DatabaseService } from '../database/database.service';
import { RAZORPAY_CLIENT } from './razorpay.provider';
import { getPlan, listPlans } from './plans';
import { VerifyPaymentDto } from './dto/verify-payment.dto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(RAZORPAY_CLIENT) private readonly razorpay: Razorpay | null,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {}

  getPlans() {
    return listPlans();
  }

  private requireClient(): Razorpay {
    if (!this.razorpay) {
      throw new ServiceUnavailableException(
        'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env.development.',
      );
    }
    return this.razorpay;
  }

  /** Resolve the advocates.id for a user (best-effort; null if onboarding incomplete). */
  private async resolveAdvocateId(userId: string): Promise<string | null> {
    const r = await this.db.query('SELECT id FROM advocates WHERE user_id = $1', [userId]);
    return r.rows[0]?.id ?? null;
  }

  /** The advocate's current subscription state (always returns an object, even if none). */
  async getMySubscription(userId: string) {
    const fallback = {
      plan_id: null,
      status: 'inactive',
      current_period_start: null,
      current_period_end: null,
      is_active: false,
    };
    try {
      const r = await this.db.query(
        `SELECT plan_id, status, current_period_start, current_period_end,
                (status = 'active' AND current_period_end > now()) AS is_active
           FROM advocate_subscription
          WHERE user_id = $1`,
        [userId],
      );
      return r.rows[0] ?? fallback;
    } catch (err: any) {
      if (err?.code === '42P01') {
        this.logger.warn('advocate_subscription table missing — run Sql/027_Billing.sql.');
        return fallback;
      }
      throw err;
    }
  }

  /** Hot path for ActiveSubscriptionGuard. */
  async isActive(userId: string): Promise<boolean> {
    try {
      const r = await this.db.query(
        `SELECT 1 FROM advocate_subscription
          WHERE user_id = $1 AND status = 'active' AND current_period_end > now()
          LIMIT 1`,
        [userId],
      );
      return (r.rowCount ?? 0) > 0;
    } catch (err: any) {
      // 42P01 = undefined_table: Sql/027_Billing.sql not applied yet. Degrade to
      // "not subscribed" (FE shows the upgrade upsell) instead of 500-ing a gated page.
      if (err?.code === '42P01') {
        this.logger.warn('advocate_subscription table missing — run Sql/027_Billing.sql. Treating as not subscribed.');
        return false;
      }
      throw err;
    }
  }

  /** Create a Razorpay order for a plan and record it (status='created'). */
  async createOrder(userId: string, planId: string) {
    const plan = getPlan(planId);
    if (!plan) throw new BadRequestException(`Unknown plan: ${planId}`);

    const rzp = this.requireClient();
    const advocateId = await this.resolveAdvocateId(userId);

    const receipt = `adv_${userId.slice(0, 8)}_${Date.now()}`;
    const order = await rzp.orders.create({
      amount: plan.amount,
      currency: plan.currency,
      receipt,
      notes: { user_id: userId, plan_id: plan.id, kind: 'advocate_saas_subscription' },
    });

    await this.db.query(
      `INSERT INTO billing_payment
         (user_id, advocate_id, plan_id, amount, currency, razorpay_order_id, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'created', $7)`,
      [userId, advocateId, plan.id, plan.amount, plan.currency, order.id, JSON.stringify({ receipt })],
    );

    // keyId is the publishable key — safe to hand to the browser to open Checkout.
    return {
      orderId: order.id,
      amount: plan.amount,
      currency: plan.currency,
      keyId: this.config.get<string>('RAZORPAY_KEY_ID'),
      plan: { id: plan.id, label: plan.label, periodMonths: plan.periodMonths },
    };
  }

  /**
   * Verify the Checkout handback signature and activate/extend the subscription.
   * Atomic + idempotent: the entitlement is only extended when a payment row actually
   * transitions created → paid, so a double-submit (or a webhook racing this) cannot
   * extend the period twice.
   */
  async verifyAndActivate(userId: string, dto: VerifyPaymentDto) {
    const keySecret = this.config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keySecret) throw new ServiceUnavailableException('Razorpay is not configured.');

    // HMAC_SHA256(order_id + "|" + payment_id, key_secret) === razorpay_signature
    const expected = createHmac('sha256', keySecret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');
    if (!this.safeEqual(expected, dto.razorpay_signature)) {
      throw new BadRequestException('Payment signature verification failed.');
    }

    return this.db.withTransaction(async (q) => {
      const upd = await q(
        `UPDATE billing_payment
            SET status = 'paid', razorpay_payment_id = $2, razorpay_signature = $3, updated_at = now()
          WHERE razorpay_order_id = $1 AND status = 'created'
          RETURNING user_id, advocate_id, plan_id`,
        [dto.razorpay_order_id, dto.razorpay_payment_id, dto.razorpay_signature],
      );

      if (upd.rowCount === 0) {
        // Already processed (idempotent) or unknown order — confirm ownership and return current state.
        const existing = await q(
          `SELECT user_id, status FROM billing_payment WHERE razorpay_order_id = $1`,
          [dto.razorpay_order_id],
        );
        if (!existing.rows[0]) throw new NotFoundException('Order not found.');
        if (existing.rows[0].user_id !== userId)
          throw new BadRequestException('Order does not belong to this user.');
        const sub = await q(
          `SELECT plan_id, status, current_period_start, current_period_end
             FROM advocate_subscription WHERE user_id = $1`,
          [userId],
        );
        return { alreadyProcessed: true, subscription: sub.rows[0] ?? null };
      }

      const row = upd.rows[0];
      if (row.user_id !== userId) {
        throw new BadRequestException('Order does not belong to this user.');
      }
      const plan = getPlan(row.plan_id);
      if (!plan) throw new BadRequestException(`Unknown plan on order: ${row.plan_id}`);

      const sub = await q(
        `INSERT INTO advocate_subscription
            (user_id, advocate_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'active', now(), now() + ($4 || ' months')::interval)
         ON CONFLICT (user_id) DO UPDATE SET
            advocate_id          = EXCLUDED.advocate_id,
            plan_id              = EXCLUDED.plan_id,
            status               = 'active',
            current_period_start = COALESCE(advocate_subscription.current_period_start, now()),
            current_period_end   = GREATEST(COALESCE(advocate_subscription.current_period_end, now()), now())
                                   + ($4 || ' months')::interval,
            updated_at           = now()
         RETURNING plan_id, status, current_period_start, current_period_end`,
        [row.user_id, row.advocate_id, row.plan_id, String(plan.periodMonths)],
      );

      this.logger.log(`Activated ${row.plan_id} for user ${userId} (order ${dto.razorpay_order_id}).`);
      return { alreadyProcessed: false, subscription: sub.rows[0] };
    });
  }

  /**
   * Razorpay webhook. Secondary, idempotent safety net behind /verify: confirms a
   * captured payment and activates if /verify somehow didn't run. No-op without a
   * configured webhook secret.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    const secret = this.config.get<string>('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('Webhook received but RAZORPAY_WEBHOOK_SECRET is not set; ignoring.');
      return { received: false };
    }
    if (!rawBody || !signature) throw new BadRequestException('Missing webhook body or signature.');

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!this.safeEqual(expected, signature)) {
      throw new BadRequestException('Invalid webhook signature.');
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    if (event?.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      if (payment?.order_id && payment?.id) {
        await this.activateFromOrder(payment.order_id, payment.id);
      }
    }
    return { received: true };
  }

  /** Idempotent activation shared by the webhook (no Checkout signature available there). */
  private async activateFromOrder(orderId: string, paymentId: string) {
    return this.db.withTransaction(async (q) => {
      const upd = await q(
        `UPDATE billing_payment
            SET status = 'paid', razorpay_payment_id = $2, updated_at = now()
          WHERE razorpay_order_id = $1 AND status = 'created'
          RETURNING user_id, advocate_id, plan_id`,
        [orderId, paymentId],
      );
      if (upd.rowCount === 0) return; // already processed or unknown order
      const row = upd.rows[0];
      const plan = getPlan(row.plan_id);
      if (!plan) return;
      await q(
        `INSERT INTO advocate_subscription
            (user_id, advocate_id, plan_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, 'active', now(), now() + ($4 || ' months')::interval)
         ON CONFLICT (user_id) DO UPDATE SET
            advocate_id          = EXCLUDED.advocate_id,
            plan_id              = EXCLUDED.plan_id,
            status               = 'active',
            current_period_start = COALESCE(advocate_subscription.current_period_start, now()),
            current_period_end   = GREATEST(COALESCE(advocate_subscription.current_period_end, now()), now())
                                   + ($4 || ' months')::interval,
            updated_at           = now()`,
        [row.user_id, row.advocate_id, row.plan_id, String(plan.periodMonths)],
      );
      this.logger.log(`Webhook activated ${row.plan_id} for user ${row.user_id} (order ${orderId}).`);
    });
  }

  private safeEqual(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
