import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import {
  generateDaySlotKeys,
  instantToIstKey,
  instantToIstParts,
} from '../common/time/ist-time.util';

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
    let scheduledAt: Date | null = null;
    if (dto.scheduledAt) {
      scheduledAt = new Date(dto.scheduledAt);
      if (isNaN(scheduledAt.getTime())) throw new BadRequestException('SCHEDULED_AT_INVALID');
      if (scheduledAt <= new Date()) throw new BadRequestException('SCHEDULED_AT_MUST_BE_FUTURE');
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

    // B-1 bounds check: if booking a specific time, it must fall on one of the
    // advocate's generated open slots (right weekday + within an active grid row,
    // on a slot boundary). All time math goes through the shared IST helper so this
    // can never drift from the availability slot generation in availability.service.
    if (scheduledAt) {
      const { date, dayOfWeek } = instantToIstParts(scheduledAt);
      const grid = await this.db.query(
        `SELECT start_time, end_time, slot_duration_minutes
         FROM advocate_availability
         WHERE advocate_id = $1 AND day_of_week = $2 AND is_active = true`,
        [dto.advocateId, dayOfWeek],
      );
      const openKeys = new Set<string>();
      for (const row of grid.rows) {
        for (const key of generateDaySlotKeys(
          date,
          row.start_time,
          row.end_time,
          row.slot_duration_minutes,
        )) {
          openKeys.add(key);
        }
      }
      if (!openKeys.has(instantToIstKey(scheduledAt))) {
        throw new BadRequestException('SLOT_NOT_AVAILABLE');
      }
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
      if (scheduledAt) {
        // B-1 collision check inside the tx: no other live booking for this
        // advocate at the same instant. scheduled_at is timestamptz, so exact
        // instant equality is correct.
        const clash = await q(
          `SELECT 1 FROM consultation_appointment ca
           JOIN consultation_request cr ON cr.request_id = ca.consultation_id
           WHERE cr.advocate_id = $1 AND ca.scheduled_at = $2 AND ca.status = 'scheduled'`,
          [dto.advocateId, scheduledAt.toISOString()],
        );
        if (clash.rows.length) {
          throw new ConflictException('SLOT_ALREADY_BOOKED');
        }
        await q(
          `INSERT INTO consultation_appointment (consultation_id, scheduled_at)
           VALUES ($1, $2)`,
          [ins.rows[0].request_id, scheduledAt.toISOString()],
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
              cr.citizen_read AS "citizenRead",
              cr.created_at, cr.updated_at,
              ca.id AS "appointmentId",
              ca.scheduled_at AS "scheduledAt",
              ca.status AS "appointmentStatus"
       FROM consultation_request cr
       LEFT JOIN consultation_appointment ca ON ca.consultation_id = cr.request_id
       WHERE cr.request_id = $1
         AND (cr.citizen_id = $2 OR cr.advocate_id IN (
               SELECT id FROM advocates WHERE user_id = $2
             ))`,
      [consultationId, userId],
    );
    if (!result.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    // Category 4: Mark as read when citizen fetches this consultation
    const row = result.rows[0];
    if (row.citizenId === userId && !row.citizenRead) {
      await this.db.query(
        `UPDATE consultation_request SET citizen_read = TRUE WHERE request_id = $1 AND citizen_id = $2`,
        [consultationId, userId],
      );
    }

    return row;
  }

  // ── GET /api/consultations (citizen's own list) — enriched ───────────────
  async listMyCitizenConsultations(citizenUserId: string) {
    const result = await this.db.query(
      `SELECT cr.request_id AS "consultationId", cr.status,
              cr.matter_id, cr.advocate_id,
              cr.citizen_read AS "unread",
              m.intake_text AS query,
              m.intake_language AS language,
              a.name AS "advocateName",
              a.verification_status AS "advocateVerificationStatus",
              (SELECT mbv.brief_json->>'en_main_analysis'
               FROM matter_brief_version mbv
               WHERE mbv.matter_id = m.matter_id
               ORDER BY mbv.generated_at DESC LIMIT 1) AS "matterBrief",
              cr.created_at, cr.updated_at,
              ca.id AS "appointmentId",
              ca.scheduled_at AS "scheduledAt",
              ca.status AS "appointmentStatus",
              EXISTS(SELECT 1 FROM consultation_feedback cf WHERE cf.consultation_id = cr.request_id AND cf.citizen_id = $1) AS "hasFeedback"
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       LEFT JOIN advocates a ON a.id = cr.advocate_id
       LEFT JOIN consultation_appointment ca ON ca.consultation_id = cr.request_id
       WHERE cr.citizen_id = $1
       ORDER BY cr.created_at DESC`,
      [citizenUserId],
    );
    // citizen_read=TRUE means seen, so unread=FALSE means badge should show
    return result.rows.map((r) => ({ ...r, unread: r.unread === false }));
  }

  // ── GET /api/consultations/unread-count ──────────────────────────────────
  async getUnreadCount(citizenUserId: string) {
    const result = await this.db.query(
      `SELECT COUNT(*)::int AS count
       FROM consultation_request
       WHERE citizen_id = $1 AND citizen_read = FALSE`,
      [citizenUserId],
    );
    return { count: result.rows[0].count };
  }

  // ── PUT /api/consultations/:id/close ─────────────────────────────────────
  async closeConsultation(consultationId: string, citizenUserId: string) {
    const existing = await this.db.query(
      `SELECT request_id, status, citizen_id FROM consultation_request WHERE request_id = $1`,
      [consultationId],
    );
    if (!existing.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    const row = existing.rows[0];
    if (row.citizen_id !== citizenUserId) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    if (row.status !== 'accepted') {
      throw new BadRequestException('Only accepted consultations can be closed');
    }

    // C-2: closing the consultation also completes any still-scheduled appointment,
    // so appointment status no longer gets stuck on 'scheduled' forever. Done in one
    // transaction with the close so the two states can't diverge.
    await this.db.withTransaction(async (q) => {
      await q(
        `UPDATE consultation_request
         SET status = 'closed', citizen_read = TRUE, updated_at = NOW()
         WHERE request_id = $1`,
        [consultationId],
      );
      await q(
        `UPDATE consultation_appointment
         SET status = 'completed', updated_at = NOW()
         WHERE consultation_id = $1 AND status = 'scheduled'`,
        [consultationId],
      );
    });

    return { consultationId, status: 'closed' };
  }
}
