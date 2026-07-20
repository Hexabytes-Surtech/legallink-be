import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { PushService } from '../push/push.service';

type CallMode = 'video' | 'voice';

interface CallSocket extends Socket {
  userId: string;
  role: string;
}

/**
 * One in-flight 1:1 call. The server is a pure signaling relay — it never sees
 * audio/video (that flows browser-to-browser, P2P). It only forwards SDP/ICE
 * between the two validated participants and tracks call lifecycle.
 */
interface CallSession {
  callId: string;
  consultationId: string;
  callerId: string;
  calleeId: string;
  callerSocketId: string;
  calleeSocketId: string | null;
  mode: CallMode;
  /** Caller display info — kept so a push and a reconnect re-ring can show it. */
  fromName: string;
  fromAvatar: string | null;
  accepted: boolean;
  timeout: ReturnType<typeof setTimeout> | null;
}

// Long enough to absorb Web Push latency + a cold app start when the callee taps
// the notification on a closed device.
const RING_TIMEOUT_MS = 45_000;

/**
 * Signaling gateway for 1:1 WebRTC video/voice calls (namespace `/call`).
 *
 * Connects app-wide (every logged-in client holds one `/call` socket), so an
 * incoming call can ring a user no matter which screen they're on. Each user is
 * placed in a private `user:<id>` room. The gateway:
 *   - validates on invite that caller+callee are the two parties of an ACCEPTED
 *     consultation (reusing the same check as the chat gateway),
 *   - relays offer/answer/ICE between exactly those two sockets,
 *   - enforces one-call-at-a-time per user and handles busy / offline / no-answer
 *     / reject / cancel / hang-up / disconnect.
 * No media and no SDP is ever persisted.
 */
@WebSocketGateway({
  namespace: '/call',
  cors: { origin: true, credentials: true },
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  // Injected by Nest after construction (definite-assignment: not set in constructor).
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(CallGateway.name);

  /** callId -> live session. */
  private sessions = new Map<string, CallSession>();
  /** userId -> callId. A user can be in at most one call (busy guard). */
  private activeByUser = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    private config: ConfigService,
    private db: DatabaseService,
    private push: PushService,
  ) {}

  // ── Connection lifecycle ──────────────────────────────────────────────────

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.query?.token as string;
      if (!token) throw new Error('No token');
      const payload = this.jwtService.verify(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      (client as CallSocket).userId = payload.sub;
      (client as CallSocket).role = payload.role;
      client.join(`user:${payload.sub}`);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = (client as CallSocket).userId;
    if (!userId) return;
    const callId = this.activeByUser.get(userId);
    if (!callId) return;
    const session = this.sessions.get(callId);
    if (!session) {
      this.activeByUser.delete(userId);
      return;
    }
    // Only treat THIS socket dropping as a call drop if it's the one in the call
    // (avoids a stale sibling tab tearing down an active call).
    const inThisCall =
      client.id === session.callerSocketId || client.id === session.calleeSocketId;
    if (!inThisCall) return;
    const peerId = session.callerId === userId ? session.calleeId : session.callerId;
    this.server.to(`user:${peerId}`).emit('call:ended', { callId, reason: 'peer-disconnected' });
    this.teardown(session);
  }

  // ── Invite ────────────────────────────────────────────────────────────────

  @SubscribeMessage('call:invite')
  async onInvite(
    @ConnectedSocket() client: CallSocket,
    @MessageBody()
    data: { consultationId: string; mode: CallMode; fromName?: string; fromAvatar?: string | null },
  ) {
    const callerId = client.userId;
    if (!callerId) return;

    const consultationId = data?.consultationId;
    const mode = data?.mode;
    if (!consultationId || (mode !== 'video' && mode !== 'voice')) {
      client.emit('call:error', { code: 'BAD_REQUEST', message: 'Invalid call request.' });
      return;
    }

    // Validate participation + active status; derive the other party.
    let row: { citizen_id: string; status: string; advocate_user_id: string | null } | undefined;
    try {
      const result = await this.db.query(
        `SELECT cr.citizen_id, cr.status, a.user_id AS advocate_user_id
           FROM consultation_request cr
           LEFT JOIN advocates a ON a.id = cr.advocate_id
          WHERE cr.request_id = $1
            AND (cr.citizen_id = $2 OR a.user_id = $2)`,
        [consultationId, callerId],
      );
      row = result.rows[0];
    } catch (err) {
      this.logger.error(`call:invite DB error: ${(err as Error).message}`);
      client.emit('call:error', { code: 'SERVER_ERROR', message: 'Could not start the call.' });
      return;
    }

    if (!row) {
      client.emit('call:error', { code: 'NOT_A_PARTICIPANT', message: 'You are not part of this consultation.' });
      return;
    }
    if (row.status !== 'accepted') {
      client.emit('call:error', {
        code: 'CONSULTATION_NOT_ACTIVE',
        message: 'Calls are only available on active consultations.',
      });
      return;
    }

    const calleeId = row.citizen_id === callerId ? row.advocate_user_id : row.citizen_id;
    if (!calleeId) {
      client.emit('call:error', { code: 'NO_PEER', message: 'The other participant is unavailable.' });
      return;
    }

    // One call at a time.
    if (this.activeByUser.has(callerId)) {
      client.emit('call:error', { code: 'ALREADY_IN_CALL', message: 'You are already in a call.' });
      return;
    }
    if (this.activeByUser.has(calleeId)) {
      client.emit('call:busy', { consultationId });
      return;
    }

    // Is the callee connected anywhere (any tab)?
    const peerSockets = await this.server.in(`user:${calleeId}`).fetchSockets();
    if (peerSockets.length === 0) {
      client.emit('call:unavailable', { consultationId });
      return;
    }

    const fromName =
      typeof data.fromName === 'string' && data.fromName.trim()
        ? data.fromName.trim().slice(0, 80)
        : 'Someone';
    const fromAvatar =
      typeof data.fromAvatar === 'string' && /^https?:\/\//i.test(data.fromAvatar)
        ? data.fromAvatar.slice(0, 300)
        : null;

    const callId = randomUUID();
    const session: CallSession = {
      callId,
      consultationId,
      callerId,
      calleeId,
      callerSocketId: client.id,
      calleeSocketId: null,
      mode,
      fromName,
      fromAvatar,
      accepted: false,
      timeout: null,
    };
    this.sessions.set(callId, session);
    this.activeByUser.set(callerId, callId);
    this.activeByUser.set(calleeId, callId);

    // Auto-cancel if nobody answers.
    session.timeout = setTimeout(() => {
      const s = this.sessions.get(callId);
      if (!s || s.accepted) return;
      this.server.to(s.callerSocketId).emit('call:timeout', { callId });
      this.server.to(`user:${s.calleeId}`).emit('call:cancelled', { callId, reason: 'timeout' });
      this.teardown(s);
    }, RING_TIMEOUT_MS);

    // Ring every tab the callee has open (instant, full signaling).
    this.server.to(`user:${calleeId}`).emit('call:incoming', {
      callId,
      consultationId,
      fromUserId: callerId,
      fromName,
      fromAvatar,
      mode,
    });
    client.emit('call:ringing', { callId });

    // Also fire a Web Push so a CLOSED app still rings. Best-effort and never throws;
    // the service worker suppresses the notification if an app window is open/visible.
    void this.push.sendToUser(calleeId, {
      type: 'incoming-call',
      callId,
      consultationId,
      mode,
      fromName,
      fromAvatar,
    });

    this.logger.log(`Call ${callId} ringing: ${callerId} -> ${calleeId} (${mode})`);
  }

  // ── Pending check (callee re-opened the app from a push / reconnected) ──────

  @SubscribeMessage('call:pending')
  onPending(@ConnectedSocket() client: CallSocket) {
    const userId = client.userId;
    if (!userId) return;
    const callId = this.activeByUser.get(userId);
    if (!callId) return;
    const s = this.sessions.get(callId);
    // Only re-ring the callee of a still-ringing call (the caller keeps its own UI).
    if (!s || s.accepted || s.calleeId !== userId) return;
    client.emit('call:incoming', {
      callId: s.callId,
      consultationId: s.consultationId,
      fromUserId: s.callerId,
      fromName: s.fromName,
      fromAvatar: s.fromAvatar,
      mode: s.mode,
    });
  }

  // ── Accept ──────────────────────────────────────────────────────────────

  @SubscribeMessage('call:accept')
  onAccept(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string }) {
    const s = this.sessions.get(data?.callId);
    if (!s || client.userId !== s.calleeId) return;
    s.accepted = true;
    s.calleeSocketId = client.id;
    if (s.timeout) {
      clearTimeout(s.timeout);
      s.timeout = null;
    }
    // Dismiss the ring on the callee's OTHER tabs.
    client.to(`user:${s.calleeId}`).emit('call:dismiss', { callId: s.callId });
    // Tell the caller to start the WebRTC offer.
    this.server.to(s.callerSocketId).emit('call:accepted', { callId: s.callId });
    this.logger.log(`Call ${s.callId} accepted`);
  }

  // ── Reject (callee declines) ──────────────────────────────────────────────

  @SubscribeMessage('call:reject')
  onReject(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string }) {
    const s = this.sessions.get(data?.callId);
    if (!s || client.userId !== s.calleeId) return;
    this.server.to(s.callerSocketId).emit('call:rejected', { callId: s.callId });
    client.to(`user:${s.calleeId}`).emit('call:dismiss', { callId: s.callId });
    this.teardown(s);
  }

  // ── Cancel (caller aborts before answer) ──────────────────────────────────

  @SubscribeMessage('call:cancel')
  onCancel(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string }) {
    const s = this.sessions.get(data?.callId);
    if (!s || client.userId !== s.callerId) return;
    this.server.to(`user:${s.calleeId}`).emit('call:cancelled', { callId: s.callId, reason: 'cancelled' });
    this.teardown(s);
  }

  // ── SDP / ICE relay (the actual WebRTC handshake) ─────────────────────────

  @SubscribeMessage('call:offer')
  onOffer(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string; sdp: unknown }) {
    this.relayToPeer(client, data?.callId, 'call:offer', { callId: data?.callId, sdp: data?.sdp });
  }

  @SubscribeMessage('call:answer')
  onAnswer(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string; sdp: unknown }) {
    this.relayToPeer(client, data?.callId, 'call:answer', { callId: data?.callId, sdp: data?.sdp });
  }

  @SubscribeMessage('call:ice')
  onIce(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string; candidate: unknown }) {
    this.relayToPeer(client, data?.callId, 'call:ice', { callId: data?.callId, candidate: data?.candidate });
  }

  // ── End (either party, during an active call) ─────────────────────────────

  @SubscribeMessage('call:end')
  onEnd(@ConnectedSocket() client: CallSocket, @MessageBody() data: { callId: string }) {
    const s = this.sessions.get(data?.callId);
    if (!s || (client.userId !== s.callerId && client.userId !== s.calleeId)) return;
    const peerId = client.userId === s.callerId ? s.calleeId : s.callerId;
    this.server.to(`user:${peerId}`).emit('call:ended', { callId: s.callId, reason: 'hangup' });
    this.teardown(s);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Forward an SDP/ICE payload to the OTHER participant's specific socket. */
  private relayToPeer(client: CallSocket, callId: string, event: string, payload: Record<string, unknown>) {
    const s = this.sessions.get(callId);
    if (!s) return;
    if (client.userId !== s.callerId && client.userId !== s.calleeId) return;
    const peerSocketId = client.userId === s.callerId ? s.calleeSocketId : s.callerSocketId;
    if (peerSocketId) this.server.to(peerSocketId).emit(event, payload);
  }

  private teardown(s: CallSession) {
    if (s.timeout) clearTimeout(s.timeout);
    this.sessions.delete(s.callId);
    if (this.activeByUser.get(s.callerId) === s.callId) this.activeByUser.delete(s.callerId);
    if (this.activeByUser.get(s.calleeId) === s.callId) this.activeByUser.delete(s.calleeId);
  }
}
