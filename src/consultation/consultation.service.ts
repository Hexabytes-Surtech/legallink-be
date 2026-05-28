import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ConsultationService {
  constructor(private db: DatabaseService) {}

  // ── POST /api/consultations ───────────────────────────────────────────────
  async requestConsultation(dto: CreateConsultationDto, citizenUserId: string) {
    // Input validation — bail on bad UUIDs with 400, not a 500 from PG.
    if (!dto?.matterId || !UUID_RE.test(dto.matterId)) {
      throw new BadRequestException('MATTER_ID_INVALID');
    }
    if (!dto?.advocateId || !UUID_RE.test(dto.advocateId)) {
      throw new BadRequestException('ADVOCATE_ID_INVALID');
    }
    if (dto.citizenNote && dto.citizenNote.length > 1000) {
      throw new BadRequestException('CITIZEN_NOTE_TOO_LONG');
    }

    // Verify matter exists and belongs to this citizen
    const matterResult = await this.db.query(
      `SELECT matter_id, citizen_id, status FROM matter WHERE matter_id = $1`,
      [dto.matterId],
    );
    if (!matterResult.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');

    const matter = matterResult.rows[0];
    if (matter.citizen_id && matter.citizen_id !== citizenUserId) {
      throw new ForbiddenException('MATTER_NOT_YOURS');
    }

    // Verify advocate exists and is verified
    const advocateResult = await this.db.query(
      `SELECT id, verification_status FROM advocates WHERE id = $1`,
      [dto.advocateId],
    );
    if (!advocateResult.rows.length) throw new NotFoundException('ADVOCATE_NOT_FOUND');
    if (advocateResult.rows[0].verification_status !== 'verified') {
      throw new BadRequestException('ADVOCATE_NOT_VERIFIED');
    }

    // Prevent duplicate pending/accepted request on the same matter+advocate pair
    const existing = await this.db.query(
      `SELECT request_id FROM consultation_request
       WHERE matter_id = $1 AND advocate_id = $2 AND status IN ('pending', 'accepted')`,
      [dto.matterId, dto.advocateId],
    );
    if (existing.rows.length) throw new ConflictException('CONSULTATION_ALREADY_EXISTS');

    // Atomically create the consultation row AND claim the matter to this citizen.
    // Pre-fix, these were two separate statements — a failure between them left the
    // matter orphaned (anonymous) while a consultation pointed at it.
    const row = await this.db.withTransaction(async (q) => {
      const ins = await q(
        `INSERT INTO consultation_request
           (matter_id, advocate_id, citizen_id, status, citizen_note)
         VALUES ($1, $2, $3, 'pending', $4)
         RETURNING request_id, status, matter_id, advocate_id, citizen_id, created_at`,
        [dto.matterId, dto.advocateId, citizenUserId, dto.citizenNote ?? null],
      );
      if (!matter.citizen_id) {
        await q(
          `UPDATE matter SET citizen_id = $1 WHERE matter_id = $2`,
          [citizenUserId, dto.matterId],
        );
      }
      return ins.rows[0];
    });

    return {
      consultationId: row.request_id,
      status: row.status,
      matterId: row.matter_id,
      advocateId: row.advocate_id,
      createdAt: row.created_at,
    };
  }

  // ── GET /api/consultations/:id ────────────────────────────────────────────
  async getConsultation(consultationId: string, userId: string) {
    const result = await this.db.query(
      `SELECT cr.request_id AS "consultationId", cr.status,
              cr.matter_id  AS "matterId",
              cr.advocate_id AS "advocateId",
              cr.citizen_id  AS "citizenId",
              cr.citizen_note AS "citizenNote",
              cr.advocate_note AS "advocateNote",
              cr.created_at, cr.updated_at
       FROM consultation_request cr
       WHERE cr.request_id = $1
         AND (cr.citizen_id = $2 OR cr.advocate_id IN (
               SELECT id FROM advocates WHERE user_id = $2
             ))`,
      [consultationId, userId],
    );
    if (!result.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    return result.rows[0];
  }

  // ── GET /api/consultations (citizen's own list) ───────────────────────────
  async listMyCitizenConsultations(citizenUserId: string) {
    const result = await this.db.query(
      `SELECT cr.request_id AS "consultationId", cr.status,
              cr.matter_id, cr.advocate_id,
              m.intake_text AS query,
              m.intake_language AS language,
              cr.created_at, cr.updated_at
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       WHERE cr.citizen_id = $1
       ORDER BY cr.created_at DESC`,
      [citizenUserId],
    );
    return result.rows;
  }
}
