import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { CallGateway } from './call.gateway';
import { CallController } from './call.controller';
import { IceService } from './ice.service';

/**
 * 1:1 WebRTC calling. `CallGateway` is the signaling relay (namespace `/call`);
 * `CallController` hands the browser its STUN/TURN ICE servers. The JWT secret is
 * resolved per-call via ConfigService (same pattern as ConversationModule).
 */
@Module({
  imports: [DatabaseModule, JwtModule.register({})],
  controllers: [CallController],
  providers: [CallGateway, IceService],
})
export class CallModule {}
