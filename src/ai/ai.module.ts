import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
