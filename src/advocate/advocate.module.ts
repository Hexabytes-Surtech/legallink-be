import { Module } from '@nestjs/common';
import { AdvocateController } from './advocate.controller';
import { AdvocateService } from './advocate.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AdvocateController],
  providers: [AdvocateService],
})
export class AdvocateModule {}
