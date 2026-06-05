import { Module } from '@nestjs/common';
import { MatchingService } from './matching.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
