import { Module } from '@nestjs/common';
import { AiChatController } from './ai-chat.controller';
import { AiController } from './ai.controller';
import { AiChatService } from './ai-chat.service';
import { DatabaseModule } from '../database/database.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [DatabaseModule, AiModule],
  controllers: [AiChatController, AiController],
  providers: [AiChatService],
  exports: [AiChatService],
})
export class AiChatModule {}
