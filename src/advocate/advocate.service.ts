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
