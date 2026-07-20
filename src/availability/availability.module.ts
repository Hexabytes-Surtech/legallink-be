import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityPublicController } from './availability-public.controller';
import { AvailabilityService } from './availability.service';
import { DatabaseModule } from '../database/database.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [DatabaseModule, BillingModule],
  controllers: [AvailabilityController, AvailabilityPublicController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
