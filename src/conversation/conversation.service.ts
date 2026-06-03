import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { UploadApiResponse } from 'cloudinary';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { ConversationGateway } from './conversation.gateway';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
// mime → attachment_type. Only images and PDFs are allowed.
const ALLOWED = new Map<string, 'image' | 'pdf'>([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['application/pdf', 'pdf'],
]);

@Injectable()
export class ConversationService {
  constructor(
    private db: DatabaseService,
    private cloudinary: CloudinaryService,
    private gateway: ConversationGateway,
  ) {}

  // Only the citizen who owns this consultation may attach/delete files on it.
  private async getCitizenConsultation(consultationId: string, citizenUserId: string) {
    const res = await this.db.query(
      `SELECT request_id, matter_id, citizen_id, status
       FROM consultation_request WHERE request_id = $1`,
      [consultationId],
    );
    if (!res.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    const c = res.rows[0];
    if (c.citizen_id !== citizenUserId) throw new ForbiddenException('NOT_YOUR_CONSULTATION');
    return c;
  }

  // ── POST /api/consultations/:id/attachments (citizen only) ─────────────────
  async uploadAttachment(
    consultationId: string,
    citizenUserId: string,
    file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('NO_FILE');
    const type = ALLOWED.get(file.mimetype);
    if (!type) throw new BadRequestException('UNSUPPORTED_FILE_TYPE');
    if (file.size > MAX_BYTES) throw new BadRequestException('FILE_TOO_LARGE');

    const c = await this.getCitizenConsultation(consultationId, citizenUserId);
    // Files can only be shared on a live (accepted) consultation.
    if (c.status !== 'accepted') throw new BadRequestException('CONSULTATION_NOT_ACTIVE');

    const uploaded = (await this.cloudinary.uploadFile(
      file,
      `${CLOUDINARY_FOLDERS.CHAT_ATTACHMENTS}/${consultationId}`,
    )) as UploadApiResponse;
    const url = uploaded.secure_url;
    const name = (file.originalname || 'file').slice(0, 255);

    const ins = await this.db.query(
      `INSERT INTO conversation_message
         (matter_id, request_id, sender_type, sender_id, content, moderation_status,
          attachment_url, attachment_type, attachment_name, attachment_size)
       VALUES ($1, $2, 'citizen', $3, '', 'cleared', $4, $5, $6, $7)
       RETURNING message_id, sender_type, sender_id, created_at`,
      [c.matter_id, consultationId, citizenUserId, url, type, name, file.size],
    );
    const row = ins.rows[0];

    const payload = {
      messageId: row.message_id,
      senderType: row.sender_type,
      senderId: row.sender_id,
      text: '',
      moderationStatus: 'cleared',
      timestamp: row.created_at,
      attachmentUrl: url,
      attachmentType: type,
      attachmentName: name,
      attachmentSize: file.size,
      deleted: false,
    };

    // Live-broadcast so the advocate sees it without reconnecting.
    this.gateway.emitMessage(consultationId, payload);
    return payload;
  }

  // ── DELETE /api/consultations/:id/attachments/:messageId (citizen only) ────
  async deleteAttachment(
    consultationId: string,
    citizenUserId: string,
    messageId: string,
  ) {
    await this.getCitizenConsultation(consultationId, citizenUserId); // participant check

    const res = await this.db.query(
      `SELECT message_id, sender_id, sender_type, attachment_url, deleted_at
       FROM conversation_message
       WHERE message_id = $1 AND request_id = $2`,
      [messageId, consultationId],
    );
    if (!res.rows.length) throw new NotFoundException('MESSAGE_NOT_FOUND');
    const m = res.rows[0];
    if (m.sender_id !== citizenUserId || m.sender_type !== 'citizen') {
      throw new ForbiddenException('NOT_YOUR_MESSAGE');
    }
    if (!m.attachment_url && !m.deleted_at) {
      throw new BadRequestException('NOT_AN_ATTACHMENT');
    }

    // Soft-delete and drop the URL so it can no longer be served.
    await this.db.query(
      `UPDATE conversation_message
       SET deleted_at = now(), attachment_url = NULL
       WHERE message_id = $1`,
      [messageId],
    );

    this.gateway.emitMessageDeleted(consultationId, messageId);
    return { messageId, deleted: true };
  }
}
