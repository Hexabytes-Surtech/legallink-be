import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { IdentityService } from '../identity/identity.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { RegisterAdvocateDto } from './dto/register-advocate.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateConsultationDto } from './dto/update-consultation.dto';

@Injectable()
export class AdvocateService {
  constructor(
    private db: DatabaseService,
    private identityService: IdentityService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ── Register ─────────────────────────────────────────────────────────────
  async register(userId: string, email: string, dto: RegisterAdvocateDto) {
    // Check idempotency — if already registered, return existing record
    const existing = await this.db.query(
      `SELECT id FROM advocates WHERE user_id = $1`,
      [userId],
    );
    if (existing.rows.length > 0) {
      // Re-issue advocate JWT and return existing advocate
      const tokens = await this.identityService.issueTokens(userId, email, 'advocate');
      return { advocateId: existing.rows[0].id, ...tokens };
    }

    // Update user role to 'advocate' in users table
    await this.db.query(
      `UPDATE users SET role = 'advocate', updated_at = now() WHERE id = $1`,
      [userId],
    );

    // Create advocate record
    const result = await this.db.query(
      `INSERT INTO advocates (user_id, bar_enrolment_number, state_bar, name, address, phone)
       VALUES ($1, $2, $3, '', '', '')
       RETURNING id`,
      [userId, dto.barEnrolmentNumber, dto.stateBar],
    );
    const advocateId = result.rows[0].id;

    // Issue new JWT with role = 'advocate'
    const tokens = await this.identityService.issueTokens(userId, email, 'advocate');
    return { advocateId, ...tokens };
  }

  // ── Update Profile ────────────────────────────────────────────────────────
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const advocate = await this.getAdvocateByUserId(userId);

    await this.db.query(
      `UPDATE advocates
       SET name = $1, address = $2, phone = $3, email = $4,
           practice_areas = $5, courts = $6, languages = $7, districts = $8,
           updated_at = now()
       WHERE id = $9`,
      [
        dto.name,
        dto.address,
        dto.phone,
        dto.email ?? null,
        dto.practiceAreas,
        dto.courts,
        dto.languages,
        dto.districts,
        advocate.id,
      ],
    );

    return { message: 'Profile updated successfully' };
  }

  // ── Upload Document ───────────────────────────────────────────────────────
  async uploadDocument(userId: string, file: Express.Multer.File) {
    const advocate = await this.getAdvocateByUserId(userId);

    // Upload to Cloudinary under legallink/documents/advocate-verification/<advocateId>/
    const uploaded = await this.cloudinaryService.uploadFile(
      file,
      `${CLOUDINARY_FOLDERS.ADVOCATE_DOCUMENTS}/${advocate.id}`,
    );
    const fileUrl = (uploaded as any).secure_url;

    // Save reference in advocate_verification_documents
    const result = await this.db.query(
      `INSERT INTO advocate_verification_documents (advocate_id, file_path, file_type)
       VALUES ($1, $2, $3)
       RETURNING id, uploaded_at`,
      [advocate.id, fileUrl, file.mimetype],
    );

    return {
      documentId: result.rows[0].id,
      fileName: file.originalname,
      fileType: file.mimetype,
      cloudinaryUrl: fileUrl,
      uploadedAt: result.rows[0].uploaded_at,
    };
  }

  // ── Update Availability ───────────────────────────────────────────────────
  // NOTE: The DB schema doesn't have an 'available' column yet — storing in a
  // simple way using verification_status or a future column. For Phase 1,
  // we return the intent and it can be added as a DB column migration later.
  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    await this.getAdvocateByUserId(userId); // ensures advocate exists
    // Placeholder — extend DB schema to add `available boolean default true`
    return { available: dto.available, message: 'Availability updated' };
  }

  // ── Submit for Verification ───────────────────────────────────────────────
  async submitVerification(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);

    await this.db.query(
      `UPDATE advocates SET verification_status = 'pending', updated_at = now() WHERE id = $1`,
      [advocate.id],
    );

    return { message: 'Submitted for admin verification', status: 'pending' };
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  async getDashboard(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);

    // Consultation counts by status
    const countsResult = await this.db.query(
      `SELECT status, COUNT(*)::int AS count
       FROM consultations WHERE advocate_id = $1
       GROUP BY status`,
      [advocate.id],
    );

    const counts: Record<string, number> = {};
    for (const row of countsResult.rows) {
      counts[row.status] = row.count;
    }

    // Unread messages (messages in accepted consultations not sent by advocate)
    const unreadResult = await this.db.query(
      `SELECT COUNT(*)::int AS count FROM messages m
       JOIN consultations c ON c.id = m.consultation_id
       WHERE c.advocate_id = $1 AND m.sender_type = 'citizen'`,
      [advocate.id],
    );

    // Profile completeness: count non-null/non-empty key fields
    const profileFields = [
      advocate.name, advocate.address, advocate.phone,
      advocate.practice_areas?.length, advocate.courts?.length,
      advocate.districts?.length, advocate.languages?.length,
    ];
    const filled = profileFields.filter(Boolean).length;
    const profileScore = Math.round((filled / profileFields.length) * 100);

    return {
      consultations: {
        requested: counts['requested'] ?? 0,
        accepted: counts['accepted'] ?? 0,
        closed: counts['closed'] ?? 0,
      },
      unreadMessages: unreadResult.rows[0].count,
      profileCompletenessScore: profileScore,
      verificationStatus: advocate.verification_status,
    };
  }

  // ── List Consultations ────────────────────────────────────────────────────
  async getConsultations(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);

    const result = await this.db.query(
      `SELECT c.id, c.status, c.requested_at, c.accepted_at,
              m.id AS matter_id, m.query_language,
              m.classification->>'matterType' AS matter_type
       FROM consultations c
       JOIN matters m ON m.id = c.matter_id
       WHERE c.advocate_id = $1
         AND c.status IN ('requested', 'accepted')
       ORDER BY c.requested_at DESC`,
      [advocate.id],
    );

    return result.rows;
  }

  // ── Get Single Consultation ───────────────────────────────────────────────
  async getConsultationById(userId: string, consultationId: string) {
    const advocate = await this.getAdvocateByUserId(userId);

    const result = await this.db.query(
      `SELECT c.id, c.status, c.requested_at, c.accepted_at,
              m.id AS matter_id, m.query_text, m.query_language,
              m.classification, m.ai_response_english, m.ai_response_bengali,
              m.citations, c.citizen_id
       FROM consultations c
       JOIN matters m ON m.id = c.matter_id
       WHERE c.id = $1 AND c.advocate_id = $2`,
      [consultationId, advocate.id],
    );

    if (!result.rows.length) throw new NotFoundException('Consultation not found');

    const consultation = result.rows[0];

    // Only expose full matter details if the consultation is accepted
    if (consultation.status !== 'accepted') {
      const { query_text, ai_response_english, ai_response_bengali, citations, ...safe } =
        consultation;
      return { ...safe, note: 'Accept the consultation to view full matter details' };
    }

    return consultation;
  }

  // ── Accept / Decline Consultation ─────────────────────────────────────────
  async updateConsultation(
    userId: string,
    consultationId: string,
    dto: UpdateConsultationDto,
  ) {
    const advocate = await this.getAdvocateByUserId(userId);

    const existing = await this.db.query(
      `SELECT id, status FROM consultations WHERE id = $1 AND advocate_id = $2`,
      [consultationId, advocate.id],
    );
    if (!existing.rows.length) throw new NotFoundException('Consultation not found');
    if (existing.rows[0].status !== 'requested') {
      throw new BadRequestException('Only requested consultations can be accepted or declined');
    }

    if (dto.action === 'accept') {
      await this.db.query(
        `UPDATE consultations SET status = 'accepted', accepted_at = now() WHERE id = $1`,
        [consultationId],
      );
      return { consultationId, status: 'accepted' };
    }

    if (dto.action === 'decline') {
      await this.db.query(
        `UPDATE consultations SET status = 'declined' WHERE id = $1`,
        [consultationId],
      );
      return { consultationId, status: 'declined', declineReason: dto.declineReason };
    }

    throw new BadRequestException('Invalid action');
  }

  // ── Get Messages ──────────────────────────────────────────────────────────
  async getMessages(userId: string, consultationId: string) {
    const advocate = await this.getAdvocateByUserId(userId);

    // Ensure the advocate is part of this consultation
    const consultation = await this.db.query(
      `SELECT id FROM consultations WHERE id = $1 AND advocate_id = $2`,
      [consultationId, advocate.id],
    );
    if (!consultation.rows.length) throw new ForbiddenException('Access denied');

    const result = await this.db.query(
      `SELECT id, sender_type, sender_id, content, moderation_status, created_at
       FROM messages
       WHERE consultation_id = $1
       ORDER BY created_at ASC`,
      [consultationId],
    );

    return result.rows;
  }

  // ── Private Helper ────────────────────────────────────────────────────────
  private async getAdvocateByUserId(userId: string) {
    const result = await this.db.query(
      `SELECT id, name, address, phone, email, practice_areas, courts,
              languages, districts, verification_status
       FROM advocates WHERE user_id = $1`,
      [userId],
    );
    if (!result.rows.length) throw new NotFoundException('Advocate profile not found');
    return result.rows[0];
  }
}
