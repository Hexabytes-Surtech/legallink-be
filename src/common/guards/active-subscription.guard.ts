import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { BillingService } from '../../billing/billing.service';

/**
 * Gates advocate TOOLING behind an active SaaS subscription.
 *
 * COMPLIANCE (docs/MONETIZATION_PLAN.md §3.3 — "the hard rule"): this guard must ONLY
 * ever protect software tooling (scheduling calendar, AI research-assist, premium
 * case-management, etc.). It must NEVER be placed on a discovery/reachability route —
 * a non-subscribing verified advocate must always remain LISTED and able to RECEIVE
 * and ACCEPT citizen-initiated consultation requests. Paying changes what TOOLS an
 * advocate has, never whether/how a citizen can reach them.
 *
 * Order: apply AFTER JwtAuthGuard (relies on req.user.sub) and RolesGuard.
 */
@Injectable()
export class ActiveSubscriptionGuard implements CanActivate {
  constructor(private readonly billing: BillingService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException(
        { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (await this.billing.isActive(userId)) return true;

    // 402 Payment Required — the frontend renders the upgrade upsell on this code.
    throw new HttpException(
      {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'An active Advocate Pro subscription is required to use this tool.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
