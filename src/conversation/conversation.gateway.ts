import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { DatabaseService } from '../database/database.service';
import { ModerationService } from '../moderation/moderation.service';

interface AuthenticatedSocket extends Socket {
  userId: string;
  role: string;
  consultationId: string;
  matterId: string;
  readOnly?: boolean; // true when the consultation is 'closed' — history viewable, writes rejected (C-1)
}

@WebSocketGateway({
  namespace: '/ws',
  cors: {
    origin: (origin: string, cb: (err: null, allow: boolean) => void) => {
      const allowed = process.env.CORS_ORIGIN?.split(',') ?? ['*'];
      if (allowed.includes('*') || !origin || allowed.includes(origin)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
    credentials: true,
  },
})
export class ConversationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ConversationGateway.name);

  constructor(
    private db: DatabaseService,
    private jwtService: JwtService,
    private config: ConfigService,
    private moderation: ModerationService,
  ) {}

  // ── Connection lifecycle ──────────────────────────────────────────────────

  async handleConnection(client: Socket) {
    try {
      // JWT comes in via handshake query: ws://host/ws/consultation/:id?token=<jwt>
      const token = client.handshake.query?.token as string;
      const consultationId = (client.handshake.query?.consultationId ??
        client.nsp.name.split('/').pop()) as string;

      if (!token) throw new UnauthorizedException('No token');

      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });

      // Verify user is a participant of this consultation
      const result = await this.db.query(
        `SELECT cr.request_id, cr.matter_id, cr.citizen_id, cr.status,
                a.user_id AS advocate_user_id
         FROM consultation_request cr
         LEFT JOIN advocates a ON a.id = cr.advocate_id
         WHERE cr.request_id = $1
           AND (cr.citizen_id = $2 OR a.user_id = $2)
           AND cr.status IN ('accepted', 'closed')`,
        [consultationId, payload.sub],
      );

      if (!result.rows.length) {
        client.emit('error', { code: 'ACCESS_DENIED', message: 'Consultation not found or not accessible' });
        client.disconnect();
        return;
      }

      const consultation = result.rows[0];
      (client as AuthenticatedSocket).userId = payload.sub;
      (client as AuthenticatedSocket).role = payload.role;
      (client as AuthenticatedSocket).consultationId = consultationId;
      (client as AuthenticatedSocket).matterId = consultation.matter_id;
      // C-1: closed consultations are read-only — history is sent, but writes are rejected.
      (client as AuthenticatedSocket).readOnly = consultation.status === 'closed';

      client.join(`consultation:${consultationId}`);

      // Send message history on connect — shape must match the broadcast
      // 'message' event so the frontend can map both with one decoder.
      const history = await this.db.query(
        `SELECT message_id AS "messageId", sender_type AS "senderType",
                sender_id AS "senderId", content AS "text",
                moderation_status AS "moderationStatus",
                created_at AS "timestamp"
         FROM conversation_message
         WHERE request_id = $1
           AND moderation_status = 'cleared'
         ORDER BY created_at ASC`,
        [consultationId],
      );

      client.emit('history', history.rows);
      this.logger.log(`User ${payload.sub} joined consultation ${consultationId}`);
    } catch (err) {
      client.emit('error', { code: 'AUTH_FAILED', message: err.message });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const authed = client as AuthenticatedSocket;
    if (authed.consultationId) {
      this.logger.log(`User ${authed.userId} left consultation ${authed.consultationId}`);
    }
  }

  // ── Message event ─────────────────────────────────────────────────────────

  @SubscribeMessage('message')
  async handleMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { text: string },
  ) {
    if (!client.userId) return;
    // C-1: closed consultations are read-only — reject new messages.
    if (client.readOnly) {
      client.emit('warning', {
        code: 'CONSULTATION_CLOSED',
        message: 'This consultation is closed. You can view the history but cannot send new messages.',
      });
      return;
    }
    if (!data?.text?.trim()) return;

    const content = data.text.trim();
    const modResult = this.moderation.check(content);

    const inserted = await this.db.query(
      `INSERT INTO conversation_message
         (matter_id, request_id, sender_type, sender_id, content,
          moderation_status, moderation_flags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING message_id, sender_type, sender_id, content,
                 moderation_status, moderation_flags, created_at`,
      [
        client.matterId,
        client.consultationId,
        client.role === 'advocate' ? 'advocate' : 'citizen',
        client.userId,
        content,
        modResult.status,
        modResult.flags,
      ],
    );

    const msg = inserted.rows[0];

    if (modResult.status === 'flagged') {
      // Send warning only to sender; message is not broadcast
      client.emit('warning', {
        code: 'MESSAGE_FLAGGED',
        message: 'Your message was flagged for review and will not be delivered.',
        flags: modResult.flags,
      });
      return;
    }

    // Broadcast to all participants in the room
    this.server.to(`consultation:${client.consultationId}`).emit('message', {
      messageId: msg.message_id,
      senderType: msg.sender_type,
      senderId: msg.sender_id,
      text: msg.content,
      moderationStatus: msg.moderation_status,
      timestamp: msg.created_at,
    });
  }

  // ── Server-initiated broadcast (C-3 / M-6) ─────────────────────────────────

  /**
   * Push a now-cleared message into its live room. Called by the admin flow after a
   * previously-flagged message is approved, so connected participants see it without
   * reconnecting. No-op if nobody is currently in the room.
   */
  emitClearedMessage(
    consultationId: string,
    payload: {
      messageId: string;
      senderType: string;
      senderId: string | null;
      text: string;
      moderationStatus: string;
      timestamp: Date;
    },
  ) {
    this.server.to(`consultation:${consultationId}`).emit('message', payload);
  }

  // ── Typing indicator ──────────────────────────────────────────────────────

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { isTyping: boolean },
  ) {
    if (!client.userId) return;
    if (client.readOnly) return; // C-1: no typing indicators on closed consultations
    client.to(`consultation:${client.consultationId}`).emit('typing', {
      senderId: client.userId,
      senderType: client.role === 'advocate' ? 'advocate' : 'citizen',
      isTyping: data?.isTyping ?? false,
    });
  }
}
