import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConversationGateway } from './conversation.gateway';
import { DatabaseModule } from '../database/database.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [
    DatabaseModule,
    ModerationModule,
    JwtModule.register({}), // secrets resolved per-call via ConfigService
  ],
  providers: [ConversationGateway],
  exports: [ConversationGateway], // AdminModule injects this for C-3 live message broadcast
})
export class ConversationModule {}
