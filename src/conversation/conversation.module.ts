import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConversationGateway } from './conversation.gateway';
import { ConversationController } from './conversation.controller';
import { ConversationService } from './conversation.service';
import { DatabaseModule } from '../database/database.module';
import { ModerationModule } from '../moderation/moderation.module';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [
    DatabaseModule,
    ModerationModule,
    CloudinaryModule,
    JwtModule.register({}), // secrets resolved per-call via ConfigService
  ],
  controllers: [ConversationController],
  providers: [ConversationGateway, ConversationService],
  exports: [ConversationGateway], // AdminModule injects this for C-3 live message broadcast
})
export class ConversationModule {}
