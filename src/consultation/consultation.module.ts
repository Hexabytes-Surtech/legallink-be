import { Module } from '@nestjs/common';
import { ConsultationController } from './consultation.controller';
import { ConsultationService } from './consultation.service';
import { DatabaseModule } from '../database/database.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [DatabaseModule, ConversationModule],
  controllers: [ConsultationController],
  providers: [ConsultationService],
  exports: [ConsultationService],
})
export class ConsultationModule {}
