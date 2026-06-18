import Razorpay from 'razorpay';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

export const RAZORPAY_CLIENT = 'RAZORPAY_CLIENT';

/**
 * Builds the Razorpay SDK client from config (test or live keys).
 *
 * If the keys are not set we return `null` rather than throwing, so the rest of the
 * app still boots in dev before keys are added. BillingService surfaces a clear
 * 503 ("Razorpay not configured") only when a billing action is actually attempted.
 */
export const RazorpayProvider = {
  provide: RAZORPAY_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Razorpay | null => {
    const key_id = config.get<string>('RAZORPAY_KEY_ID');
    const key_secret = config.get<string>('RAZORPAY_KEY_SECRET');
    if (!key_id || !key_secret) {
      new Logger('RazorpayProvider').warn(
        'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — billing endpoints will return 503 until configured.',
      );
      return null;
    }
    return new Razorpay({ key_id, key_secret });
  },
};
