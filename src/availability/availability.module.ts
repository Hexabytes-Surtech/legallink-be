import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityPublicController } from './availability-public.controller';
import { AvailabilityService } from './availability.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AvailabilityController, AvailabilityPublicController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
