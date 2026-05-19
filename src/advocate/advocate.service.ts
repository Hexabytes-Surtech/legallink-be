import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
      `SELECT c.id, c.status, c.requested_at, c.accepted_at,
              m.query_text, m.query_language, m.classification,
              u.id AS citizen_user_id
       FROM consultations c
       JOIN matters m ON m.id = c.matter_id
       JOIN users u ON u.id = c.citizen_id
       WHERE c.advocate_id = $1
       ORDER BY c.requested_at DESC`,
      [advocate.id],
    );
    return result.rows;
  }

  async getConsultationById(userId: string, consultationId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const result = await this.db.query(
      `SELECT c.id, c.status, c.requested_at, c.accepted_at,
              m.id AS matter_id, m.query_text, m.query_language,
              m.classification, m.citations,
              m.ai_response_english, m.ai_response_bengali,
              u.id AS citizen_user_id
       FROM consultations c
       JOIN matters m ON m.id = c.matter_id
       JOIN users u ON u.id = c.citizen_id
       WHERE c.id = $1 AND c.advocate_id = $2`,
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
      `SELECT id, status FROM consultations WHERE id = $1 AND advocate_id = $2`,
      [consultationId, advocate.id],
    );
    if (!existing.rows.length) throw new NotFoundException('Consultation not found');
    if (existing.rows[0].status !== 'requested')
      throw new BadRequestException('Consultation is not in requested state');

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    await this.db.query(
      `UPDATE consultations
       SET status = $1, accepted_at = ${action === 'accept' ? 'NOW()' : 'NULL'}
       WHERE id = $2`,
      [newStatus, consultationId],
    );
    return { consultationId, status: newStatus, ...(declineReason && { declineReason }) };
  }

  async getDashboard(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const stats = await this.db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'requested') AS pending_count,
         COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted_count,
         COUNT(*) FILTER (WHERE status = 'declined')  AS declined_count,
         COUNT(*) FILTER (WHERE status = 'closed')    AS closed_count,
         COUNT(*)                                      AS total_count
       FROM consultations WHERE advocate_id = $1`,
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
