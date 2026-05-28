import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdvocatesQueryDto } from './dto/advocates-query.dto';

@Injectable()
export class AdvocateService {
  constructor(
    private db: DatabaseService,
    private cloudinaryService: CloudinaryService,
  ) {}

  // ── GET /api/advocate/me ───────────────────────────────────────────────
  async getMe(userId: string) {
    const result = await this.db.query(
      `SELECT a.id AS advocate_id, a.name, a.address, a.phone, a.email AS advocate_email,
              a.bar_enrolment_number, a.state_bar,
              a.practice_areas, a.courts, a.languages, a.districts,
              a.verification_status, a.created_at, a.updated_at,
              u.email AS auth_email, u.preferred_language, u.avatar_url
       FROM advocates a
       JOIN users u ON u.id = a.user_id
       WHERE a.user_id = $1`,
      [userId],
    );
    if (!result.rows.length) {
      throw new NotFoundException({ code: 'ADVOCATE_PROFILE_NOT_FOUND' });
    }
    return result.rows[0];
  }

  // ── GET /api/advocate/documents ────────────────────────────────────────
  async getDocuments(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const result = await this.db.query(
      `SELECT id, file_path, file_type, uploaded_at
       FROM advocate_verification_documents
       WHERE advocate_id = $1
       ORDER BY uploaded_at DESC`,
      [advocate.id],
    );
    return result.rows;
  }

  // ── API 7 — Update Advocate Profile (partial updates) ─────────────────
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const advocate = await this.getAdvocateByUserId(userId);

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, any> = {
      name: dto.name,
      address: dto.address,
      phone: dto.phone,
      email: dto.email,
      bio: dto.bio,
      bar_enrolment_number: dto.barEnrolmentNumber,
      state_bar: dto.stateBar,
      practice_areas: dto.practiceAreas,
      courts: dto.courts,
      languages: dto.languages,
      districts: dto.districts,
    };

    for (const [column, value] of Object.entries(fieldMap)) {
      if (value !== undefined) {
        setClauses.push(`${column} = $${paramIndex++}`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      return this.getMergedAdvocateProfile(userId, advocate.id);
    }

    setClauses.push(`updated_at = now()`);
    params.push(advocate.id);

    await this.db.query(
      `UPDATE advocates SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      params,
    );

    return this.getMergedAdvocateProfile(userId, advocate.id);
  }

  // ── API 8 — Upload Document ───────────────────────────────────────────
  async uploadDocument(userId: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No document file provided');
    }

    const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Allowed: application/pdf, image/jpeg, image/png',
      );
    }

    const advocate = await this.getAdvocateByUserId(userId);

    const uploaded = await this.cloudinaryService.uploadFile(
      file,
      `${CLOUDINARY_FOLDERS.ADVOCATE_DOCUMENTS}/${advocate.id}`,
    );
    const fileUrl = (uploaded as any).secure_url;

    const result = await this.db.query(
      `INSERT INTO advocate_verification_documents (advocate_id, file_path, file_type)
       VALUES ($1, $2, $3)
       RETURNING id, file_path, file_type, uploaded_at`,
      [advocate.id, fileUrl, file.mimetype],
    );

    const doc = result.rows[0];
    return {
      documentId: doc.id,
      file_path: doc.file_path,
      file_type: doc.file_type,
      uploaded_at: doc.uploaded_at,
    };
  }

  async getConsultations(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const result = await this.db.query(
      `SELECT cr.request_id AS id, cr.status, cr.created_at AS requested_at, cr.updated_at,
              cr.citizen_note, cr.advocate_note,
              m.matter_id, m.intake_text AS query_text, m.intake_language AS query_language,
              m.classification_json AS classification,
              cr.citizen_id AS citizen_user_id
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       WHERE cr.advocate_id = $1
       ORDER BY cr.created_at DESC`,
      [advocate.id],
    );
    return result.rows;
  }

  async getConsultationById(userId: string, consultationId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const result = await this.db.query(
      `SELECT cr.request_id AS id, cr.status, cr.created_at AS requested_at, cr.updated_at,
              cr.citizen_note, cr.advocate_note,
              m.matter_id, m.intake_text AS query_text, m.intake_language AS query_language,
              m.classification_json AS classification,
              mbv.brief_json,
              cr.citizen_id AS citizen_user_id
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       LEFT JOIN matter_brief_version mbv ON mbv.matter_id = m.matter_id
       WHERE cr.request_id = $1 AND cr.advocate_id = $2
       ORDER BY mbv.generated_at DESC
       LIMIT 1`,
      [consultationId, advocate.id],
    );
    if (!result.rows.length) throw new NotFoundException('Consultation not found');
    return result.rows[0];
  }

  async updateConsultation(
    userId: string,
    consultationId: string,
    action: 'accept' | 'decline',
    declineReason?: string,
  ) {
    const advocate = await this.getAdvocateByUserId(userId);
    const existing = await this.db.query(
      `SELECT request_id, status FROM consultation_request
       WHERE request_id = $1 AND advocate_id = $2`,
      [consultationId, advocate.id],
    );
    if (!existing.rows.length) throw new NotFoundException('Consultation not found');
    if (existing.rows[0].status !== 'pending')
      throw new BadRequestException('Consultation is not in pending state');

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const advocateNote = declineReason ?? null;
    await this.db.query(
      `UPDATE consultation_request
       SET status = $1, advocate_note = $2, updated_at = NOW()
       WHERE request_id = $3`,
      [newStatus, advocateNote, consultationId],
    );
    return { consultationId, status: newStatus, ...(declineReason && { declineReason }) };
  }

  async getDashboard(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const stats = await this.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
         COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted_count,
         COUNT(*) FILTER (WHERE status = 'declined')  AS declined_count,
         COUNT(*) FILTER (WHERE status = 'closed')    AS closed_count,
         COUNT(*)                                      AS total_count
       FROM consultation_request WHERE advocate_id = $1`,
      [advocate.id],
    );
    return {
      advocateId: advocate.id,
      verificationStatus: advocate.verification_status,
      profileCompleteness: this.calculateProfileCompleteness(advocate),
      consultationStats: stats.rows[0],
    };
  }

  async submitVerification(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    if (advocate.verification_status === 'verified')
      throw new BadRequestException('Already verified');
    if (!advocate.bar_enrolment_number || !advocate.state_bar || !advocate.name || !advocate.address)
      throw new BadRequestException('Complete your profile before submitting for verification');
    return {
      advocateId: advocate.id,
      verificationStatus: advocate.verification_status,
      message: 'Profile submitted for admin review',
    };
  }

  private calculateProfileCompleteness(advocate: any): number {
    const fields = [
      advocate.bar_enrolment_number,
      advocate.state_bar,
      advocate.name,
      advocate.address,
      advocate.practice_areas?.length > 0,
      advocate.courts?.length > 0,
      advocate.languages?.length > 0,
      advocate.districts?.length > 0,
    ];
    const filled = fields.filter(Boolean).length;
    return Math.round((filled / fields.length) * 100);
  }

  // ── Public Directory (no auth) ────────────────────────────────────────

  async getPublicList(query: AdvocatesQueryDto) {
    const page = Math.max(1, parseInt(query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(query.limit as string) || 10));
    const offset = (page - 1) * limit;
    const verifiedOnly = query.verifiedOnly !== 'false';

    // Normalise single string → array for array filter params
    const practiceAreas = query.practiceArea
      ? (Array.isArray(query.practiceArea) ? query.practiceArea : [query.practiceArea])
      : null;
    const languages = query.language
      ? (Array.isArray(query.language) ? query.language : [query.language])
      : null;
    const district = query.district ?? null;

    const filterParams = [verifiedOnly, practiceAreas, languages, district];

    const rows = await this.db.query(
      `SELECT a.id, a.name, a.bio, a.practice_areas, a.languages, a.districts,
              a.state_bar, a.verification_status, u.avatar_url
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE ($1 = false OR a.verification_status = 'verified')
         AND ($2::text[] IS NULL OR a.practice_areas && $2::text[])
         AND ($3::text[] IS NULL OR a.languages && $3::text[])
         AND ($4::text IS NULL OR $4 = ANY(a.districts))
       ORDER BY (a.verification_status = 'verified') DESC, a.name ASC
       LIMIT $5 OFFSET $6`,
      [...filterParams, limit, offset],
    );

    const countResult = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM advocates a
       WHERE ($1 = false OR a.verification_status = 'verified')
         AND ($2::text[] IS NULL OR a.practice_areas && $2::text[])
         AND ($3::text[] IS NULL OR a.languages && $3::text[])
         AND ($4::text IS NULL OR $4 = ANY(a.districts))`,
      filterParams,
    );

    const total: number = countResult.rows[0].total;
    return {
      advocates: rows.rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async getPublicById(id: string) {
    const result = await this.db.query(
      `SELECT a.id, a.name, a.bio, a.practice_areas, a.languages, a.districts,
              a.state_bar, a.verification_status, a.courts, a.bar_enrolment_number,
              u.avatar_url
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.id = $1`,
      [id],
    );
    if (!result.rows.length) {
      throw new NotFoundException('Advocate not found');
    }
    return result.rows[0];
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private async getAdvocateByUserId(userId: string) {
    const result = await this.db.query(
      `SELECT id, name, address, phone, email,
              bar_enrolment_number, state_bar,
              practice_areas, courts, languages, districts,
              verification_status
       FROM advocates WHERE user_id = $1`,
      [userId],
    );
    if (!result.rows.length)
      throw new NotFoundException('Advocate profile not found');
    return result.rows[0];
  }

  private async getMergedAdvocateProfile(userId: string, advocateId: string) {
    const result = await this.db.query(
      `SELECT a.id AS advocate_id, a.name, a.address, a.phone, a.email AS advocate_email,
              a.bar_enrolment_number, a.state_bar,
              a.practice_areas, a.courts, a.languages, a.districts,
              a.verification_status, a.created_at, a.updated_at,
              u.email AS user_email, u.preferred_language, u.avatar_url
       FROM advocates a
       JOIN users u ON u.id = a.user_id
       WHERE a.id = $1 AND a.user_id = $2`,
      [advocateId, userId],
    );
    if (!result.rows.length)
      throw new NotFoundException('Advocate profile not found');
    return result.rows[0];
  }
}
