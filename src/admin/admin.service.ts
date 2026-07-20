import { Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmailService } from '../email/email.service';
import { ConversationGateway } from '../conversation/conversation.gateway';
import { NotificationsGateway } from '../conversation/notifications.gateway';

@Injectable()
export class AdminService {
  constructor(
    private db: DatabaseService,
    private emailService: EmailService,
    private conversationGateway: ConversationGateway,
    private notifications: NotificationsGateway,
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
    // Category 5: JOIN users to get email for notification (+ user_id for the live nudge)
    const existing = await this.db.query(
      `SELECT a.id, a.name, a.user_id AS advocate_user_id, u.email AS user_email
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
    const { name, user_email, advocate_user_id } = existing.rows[0];

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

    // Live: flip the advocate's own verification banner/badge in their open session,
    // and drop this application off every admin's pending queue in real time.
    this.notifications.emitDataChanged(advocate_user_id, 'verification', {
      kind: action === 'approve' ? 'verification_approved' : 'verification_rejected',
    });
    this.notifications.emitDataChangedToRole('admin', 'admin-advocates');

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

      // Live-bump the RECIPIENT (the non-sender) so their conversation-list unread
      // badge updates without a refresh. The count itself comes from the API
      // (created_at vs last-read) — so it increments in the common case where the
      // recipient hadn't read past this once-hidden message.
      const parts = await this.db.query(
        `SELECT cr.citizen_id, a.user_id AS advocate_user_id
         FROM consultation_request cr
         JOIN advocates a ON a.id = cr.advocate_id
         WHERE cr.request_id = $1`,
        [m.request_id],
      );
      if (parts?.rows?.length) {
        const p = parts.rows[0];
        const recipientUserId =
          m.sender_type === 'advocate' ? p.citizen_id : p.advocate_user_id;
        if (recipientUserId) {
          this.notifications.emitUnreadBump(recipientUserId, { consultationId: m.request_id });
        }
      }
    }

    // The flagged-message queue just shrank (this message was cleared/dismissed) —
    // refresh it live for every connected admin.
    this.notifications.emitDataChangedToRole('admin', 'admin-moderation');

    return { messageId, moderationStatus: newStatus, action };
  }

  // ── List citizen reports (advocate → admin) ───────────────────────────────
  // Open reports first, then most recent. Joins the reporter advocate, the reported
  // citizen, and a snippet of the matter for context.
  async getReports() {
    const result = await this.db.query(
      `SELECT r.id AS "reportId",
              r.consultation_id AS "consultationId",
              r.reason, r.note, r.status,
              r.admin_note AS "adminNote",
              r.created_at AS "createdAt",
              r.reviewed_at AS "reviewedAt",
              a.name AS "advocateName",
              COALESCE(cu.name, 'Citizen') AS "citizenName",
              cu.email AS "citizenEmail",
              LEFT(m.intake_text, 240) AS "matterSnippet"
       FROM citizen_report r
       JOIN advocates a ON a.id = r.advocate_id
       LEFT JOIN users cu ON cu.id = r.citizen_id
       LEFT JOIN consultation_request cr ON cr.request_id = r.consultation_id
       LEFT JOIN matter m ON m.matter_id = cr.matter_id
       ORDER BY (r.status = 'open') DESC, r.created_at DESC`,
    );
    return result.rows;
  }

  // ── Resolve a citizen report ──────────────────────────────────────────────
  async resolveReport(
    reportId: string,
    action: 'review' | 'dismiss',
    note?: string,
  ) {
    const existing = await this.db.query(
      `SELECT id FROM citizen_report WHERE id = $1`,
      [reportId],
    );
    if (!existing.rows.length) throw new NotFoundException('Report not found');

    const newStatus = action === 'review' ? 'reviewed' : 'dismissed';
    await this.db.query(
      `UPDATE citizen_report
       SET status = $1, admin_note = $2, reviewed_at = now()
       WHERE id = $3`,
      [newStatus, note?.trim() || null, reportId],
    );

    // Keep every admin's reports queue in sync live (status moved off 'open').
    this.notifications.emitDataChangedToRole('admin', 'admin-reports');

    return { reportId, status: newStatus, action };
  }
}
