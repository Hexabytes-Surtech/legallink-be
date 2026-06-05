import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private db: DatabaseService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredAnonymousMatters() {
    const result = await this.db.query(
      `DELETE FROM matter
       WHERE citizen_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING matter_id`,
    );
    if (result.rowCount && result.rowCount > 0) {
      this.logger.log(`Cleaned up ${result.rowCount} expired anonymous matter(s)`);
    }
  }

  // Same 24h window as anonymous matters: an unclaimed AI chat is reaped once its
  // expires_at passes. ai_conversation_message rows cascade-delete with the parent.
  @Cron(CronExpression.EVERY_HOUR)
  async deleteExpiredAnonymousConversations() {
    const result = await this.db.query(
      `DELETE FROM ai_conversation
       WHERE citizen_id IS NULL
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       RETURNING conversation_id`,
    );
    if (result.rowCount && result.rowCount > 0) {
      this.logger.log(`Cleaned up ${result.rowCount} expired anonymous conversation(s)`);
    }
  }
}
