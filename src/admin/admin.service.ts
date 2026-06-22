import { Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { ConversationGateway } from '../conversation/conversation.gateway';

@Injectable()
export class AdminService {
  constructor(
    private db: DatabaseService,
    private emailService: EmailService,
    private conversationGateway: ConversationGateway,
  ) {}

  // ── List pending advocates ────────────────────────────────────────────────
  // BUG-1: Filter by 'submitted' — advocates only appear here after they explicitly
  // click "Submit for Verification" which sets status='submitted'.
  async getPendingAdvocates() {
    const result = await this.db.query(
      `SELECT a.id, a.bar_enrolment_number, a.state_bar, a.name, a.address,
              a.phone, a.email, a.practice_areas, a.courts, a.languages,
              a.districts, a.verification_status, a.submitted_at, a.created_at,
              u.email AS user_email,
              COALESCE(
                json_agg(
                  json_build_object('id', d.id, 'fileUrl', d.file_path, 'fileType', d.file_type, 'uploadedAt', d.uploaded_at)
                ) FILTER (WHERE d.id IS NOT NULL),
                '[]'
              ) AS documents
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN advocate_verification_documents d ON d.advocate_id = a.id
       WHERE a.verification_status = 'submitted'
       GROUP BY a.id, u.email
       ORDER BY a.submitted_at ASC NULLS LAST`,
    );
    return result.rows;
  }

  // ── Approve or reject an advocate ─────────────────────────────────────────
  async verifyAdvocate(
    advocateId: string,
    action: 'approve' | 'reject',
    reason?: string,
  ) {
    // Category 5: JOIN users to get email for notification
    const existing = await this.db.query(
      `SELECT a.id, a.name, u.email AS user_email
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [advocateId],
    );
    if (!existing.rows.length)
      throw new NotFoundException('Advocate not found');

    // A rejection must carry a reason — it's emailed to the advocate so they know
    // what to fix. Without this guard a reject could silently send an empty reason.
    if (action === 'reject' && !reason?.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const newStatus = action === 'approve' ? 'verified' : 'rejected';
    const { name, user_email } = existing.rows[0];

    await this.db.query(
      `UPDATE advocates SET verification_status = $1, rejection_reason = $2, updated_at = now() WHERE id = $3`,
      [newStatus, action === 'reject' ? (reason ?? null) : null, advocateId],
    );

    // Category 5: Send email notification (non-fatal)
    if (user_email) {
      if (action === 'approve') {
        this.emailService.sendAdvocateVerified(user_email, name ?? 'Advocate').catch(() => {});
      } else {
        this.emailService.sendAdvocateRejected(user_email, name ?? 'Advocate', reason).catch(() => {});
      }
    }

    return {
      advocateId,
      verificationStatus: newStatus,
      ...(reason && { reason }),
    };
  }

  // ── List flagged messages ──────────────────────────────────────────────────
  async getFlaggedMessages() {
    const result = await this.db.query(
      `SELECT cm.message_id AS "messageId",
              cm.request_id AS "consultationId",
              cm.matter_id  AS "matterId",
              cm.sender_type AS "senderType",
              cm.sender_id  AS "senderId",
              cm.content,
              cm.moderation_status AS "moderationStatus",
              cm.moderation_flags AS "moderationFlags",
              cm.created_at AS "createdAt"
       FROM conversation_message cm
       WHERE cm.moderation_status = 'flagged'
       ORDER BY cm.created_at DESC`,
    );
    return result.rows;
  }

  // ── Approve or dismiss a flagged message ──────────────────────────────────
  async updateMessageStatus(
    messageId: string,
    action: 'approve' | 'dismiss',
  ) {
    const existing = await this.db.query(
      `SELECT message_id, request_id, sender_type, sender_id, content, created_at
       FROM conversation_message WHERE message_id = $1`,
      [messageId],
    );
    if (!existing.rows.length)
      throw new NotFoundException('Message not found');

    // approve = admin confirms content is fine → 'cleared' (message becomes visible)
    // dismiss = admin confirms rule36 violation → 'dismissed' (message stays hidden)
    const newStatus = action === 'approve' ? 'cleared' : 'dismissed';

    await this.db.query(
      `UPDATE conversation_message
       SET moderation_status = $1
       WHERE message_id = $2`,
      [newStatus, messageId],
    );

    // C-3 (M-6): a newly-cleared message is pushed into the live chat room so
    // connected participants see it without reconnecting. Shape matches the
    // gateway's own 'message' broadcast so the frontend decodes both identically.
    if (action === 'approve') {
      const m = existing.rows[0];
      this.conversationGateway.emitClearedMessage(m.request_id, {
        messageId: m.message_id,
        senderType: m.sender_type,
        senderId: m.sender_id,
        text: m.content,
        moderationStatus: newStatus,
        timestamp: m.created_at,
      });
    }

    return { messageId, moderationStatus: newStatus, action };
  }
}
