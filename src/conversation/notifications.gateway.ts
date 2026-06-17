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
 *
 * The same channel also carries generic `data:changed` events (see emitDataChanged /
 * emitDataChangedToRole). Each connected socket joins BOTH a private `user:<id>` room
 * and a `role:<role>` room, so the backend can nudge one user (e.g. "your consultation
 * was accepted") or a whole role (e.g. "a new report landed in the admin queue").
 * The payload is just a `{ topic }` tag — the client silently refetches that resource
 * and lights up a sidebar badge. Best-effort: a missed event only leaves a list as
 * stale as a manual-refresh build, never broken.
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
      // Role room lets us broadcast to "all admins", "all advocates", etc. without
      // tracking individual user ids (used for the admin queues).
      if (payload.role) client.join(`role:${payload.role}`);
    } catch {
      client.disconnect();
    }
  }

  /** Nudge a user's open clients that a conversation has a new unread message. */
  emitUnreadBump(userId: string, payload: { consultationId: string }) {
    if (!userId) return;
    this.server.to(`user:${userId}`).emit('unread_bump', payload);
  }

  /**
   * Tell ONE user's open clients that a data `topic` changed (e.g. 'consultations',
   * 'verification') so they silently refetch and badge it. No-op if userId is missing.
   */
  emitDataChanged(
    userId: string | null | undefined,
    topic: string,
    payload: Record<string, unknown> = {},
  ) {
    if (!userId) return;
    this.server.to(`user:${userId}`).emit('data:changed', { topic, ...payload });
  }

  /**
   * Tell EVERY connected client of a role (e.g. 'admin') that a data `topic` changed —
   * used for shared queues that any admin should see update live.
   */
  emitDataChangedToRole(
    role: string,
    topic: string,
    payload: Record<string, unknown> = {},
  ) {
    if (!role) return;
    this.server.to(`role:${role}`).emit('data:changed', { topic, ...payload });
  }
}
