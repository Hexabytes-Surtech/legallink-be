import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * Web Push (VAPID) — lets the backend wake a CLOSED PWA with an incoming-call
 * notification. Exports PushService so the call gateway can fire a push alongside
 * its Socket.IO ring. ConfigService is global, so no extra imports are needed.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
