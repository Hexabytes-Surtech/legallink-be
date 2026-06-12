import { WebSocketGateway, WebSocketServer, OnGatewayConnection } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';

/**
 * User-level notification channel (namespace /notify), separate from the per-
 * consultation chat gateway. A client connects with just its access token and is
 * placed in a private `user:<id>` room. The chat gateway / conversation service push
 * a lightweight `unread_bump` here when a NEW message lands for that user, so their
 * conversation list can update its unread badge live — without opening a socket per
 * conversation. The bump carries no message content; the client refetches counts
 * from the API (DB stays the source of truth).
 */
@WebSocketGateway({
  namespace: '/notify',
  cors: {
    origin: (origin: string, cb: (err: null, allow: boolean) => void) => {
      const allowed = process.env.CORS_ORIGIN?.split(',') ?? ['*'];
      if (allowed.includes('*') || !origin || allowed.includes(origin)) cb(null, true);
      else cb(null, false);
    },
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.query?.token as string;
      if (!token) throw new Error('No token');
      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  /** Nudge a user's open clients that a conversation has a new unread message. */
  emitUnreadBump(userId: string, payload: { consultationId: string }) {
    if (!userId) return;
    this.server.to(`user:${userId}`).emit('unread_bump', payload);
  }
}
