import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ModerationModule } from '../moderation/moderation.module';
import { FeedbackService } from './feedback.service';
import { FeedbackController } from './feedback.controller';
import { FeedbackPublicController } from './feedback-public.controller';

@Module({
  imports: [DatabaseModule, ModerationModule],
  controllers: [FeedbackController, FeedbackPublicController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
