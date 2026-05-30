import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DatabaseModule } from '../database/database.module';
import { EmailModule } from '../email/email.module';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [DatabaseModule, EmailModule, ConversationModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
