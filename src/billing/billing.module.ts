import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { RazorpayProvider } from './razorpay.provider';
import { ActiveSubscriptionGuard } from '../common/guards/active-subscription.guard';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [BillingController],
  providers: [BillingService, RazorpayProvider, ActiveSubscriptionGuard],
  // Exported so other feature modules (e.g. AvailabilityModule) can gate their
  // TOOLING routes behind ActiveSubscriptionGuard / query BillingService.
  exports: [BillingService, ActiveSubscriptionGuard],
})
export class BillingModule {}
