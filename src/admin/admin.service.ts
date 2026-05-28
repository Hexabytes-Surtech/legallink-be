import { Injectable, NotFoundException } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AdminService {
  constructor(private db: DatabaseService) {}

  // ── List pending advocates ────────────────────────────────────────────────
  async getPendingAdvocates() {
    const result = await this.db.query(
      `SELECT a.id, a.bar_enrolment_number, a.state_bar, a.name, a.address,
              a.phone, a.email, a.practice_areas, a.courts, a.languages,
              a.districts, a.verification_status, a.created_at,
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
       WHERE a.verification_status = 'pending'
       GROUP BY a.id, u.email
       ORDER BY a.created_at ASC`,
    );
    return result.rows;
  }

  // ── Approve or reject an advocate ─────────────────────────────────────────
  async verifyAdvocate(
    advocateId: string,
    action: 'approve' | 'reject',
    reason?: string,
  ) {
    const existing = await this.db.query(
      `SELECT id FROM advocates WHERE id = $1`,
      [advocateId],
    );
    if (!existing.rows.length)
      throw new NotFoundException('Advocate not found');

    const newStatus = action === 'approve' ? 'verified' : 'rejected';

    await this.db.query(
      `UPDATE advocates SET verification_status = $1, updated_at = now() WHERE id = $2`,
      [newStatus, advocateId],
    );

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
      `SELECT message_id FROM conversation_message WHERE message_id = $1`,
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

    return { messageId, moderationStatus: newStatus, action };
  }
}
