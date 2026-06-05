import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { GeminiAiService } from './gemini-ai.service';
import { GeminiChatService } from './gemini-chat.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  providers: [GeminiAiService, GeminiChatService, AiService],
  exports: [AiService, GeminiChatService],
})
export class AiModule {}
