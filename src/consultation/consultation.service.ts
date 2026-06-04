import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConversationGateway } from '../conversation/conversation.gateway';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { ReportCitizenDto } from './dto/report-citizen.dto';
import {
  generateDaySlotKeys,
  instantToIstKey,
  instantToIstParts,
} from '../common/time/ist-time.util';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ConsultationService {
  constructor(
    private db: DatabaseService,
    private gateway: ConversationGateway,
  ) {}

  // ── POST /api/consultations ───────────────────────────────────────────────
  async requestConsultation(
    dto: CreateConsultationDto,
    citizenUserId: string,
    sessionId: string | null = null,
  ) {
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

    // Verify matter exists and the caller is allowed to act on it.
    const matterResult = await this.db.query(
      `SELECT matter_id, citizen_id, session_id, status FROM matter WHERE matter_id = $1`,
      [dto.matterId],
    );
    if (!matterResult.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');

    const matter = matterResult.rows[0];
    // Access mirrors getMatterById exactly so this write path can't be looser than
    // the read path:
    //   • Owned matter  → caller must be the owner.
    //   • Anonymous matter (citizen_id NULL) → caller's session cookie must match the
    //     matter's session_id. Without this, anyone with a leaked anonymous matter URL
    //     could claim (permanently hijack) someone else's confidential matter.
    if (matter.citizen_id) {
      if (matter.citizen_id !== citizenUserId) {
        throw new ForbiddenException('MATTER_NOT_YOURS');
      }
    } else {
      if (!sessionId || matter.session_id !== sessionId) {
        throw new ForbiddenException('MATTER_NOT_YOURS');
      }
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

    // Once ANY advocate has accepted a consultation on this matter, the citizen is
    // committed to that advocate until it ends — they can't shop the same matter
    // around to others. (Declined/closed don't block; a new request is allowed then.)
    const active = await this.db.query(
      `SELECT request_id FROM consultation_request
       WHERE matter_id = $1 AND status = 'accepted'`,
      [dto.matterId],
    );
    if (active.rows.length) throw new ConflictException('MATTER_HAS_ACTIVE_CONSULTATION');

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
    let row;
    try {
      row = await this.db.withTransaction(async (q) => {
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
          // B-1 collision check inside the tx: a friendly fast-path that returns a
          // clean 409 in the common case. The real atomicity guarantee is the
          // partial unique index uq_appt_advocate_slot (advocate_id, scheduled_at)
          // WHERE status='scheduled' — under READ COMMITTED two concurrent bookings
          // both see zero rows here, but only one INSERT can win the index.
          const clash = await q(
            `SELECT 1 FROM consultation_appointment ca
             WHERE ca.advocate_id = $1 AND ca.scheduled_at = $2 AND ca.status = 'scheduled'`,
            [dto.advocateId, scheduledAt.toISOString()],
          );
          if (clash.rows.length) {
            throw new ConflictException('SLOT_ALREADY_BOOKED');
          }
          await q(
            `INSERT INTO consultation_appointment (consultation_id, advocate_id, scheduled_at)
             VALUES ($1, $2, $3)`,
            [ins.rows[0].request_id, dto.advocateId, scheduledAt.toISOString()],
          );
        }
        return ins.rows[0];
      });
    } catch (err: any) {
      // 23505 here can only be the slot index losing the race (consultation_id is
      // freshly generated, so its unique key can't collide) → surface as 409.
      if (err?.code === '23505') {
        throw new ConflictException('SLOT_ALREADY_BOOKED');
      }
      throw err;
    }

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

    // Mark as read when the citizen opens this consultation: flip the activity flag
    // AND advance the read position so the numeric unread badge clears.
    const row = result.rows[0];
    if (row.citizenId === userId) {
      await this.db.query(
        `UPDATE consultation_request
         SET citizen_read = TRUE, citizen_last_read_at = NOW()
         WHERE request_id = $1 AND citizen_id = $2`,
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
              (SELECT COUNT(*)::int FROM conversation_message cm
                WHERE cm.request_id = cr.request_id
                  AND cm.sender_type = 'advocate'
                  AND cm.deleted_at IS NULL
                  AND cm.moderation_status = 'cleared'
                  AND (cr.citizen_last_read_at IS NULL OR cm.created_at > cr.citizen_last_read_at)
              ) AS "unreadCount",
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
    // `unread` (boolean) = has new activity incl. acceptance; `unreadCount` = unseen
    // advocate messages for the numeric badge. citizen_read=TRUE means seen.
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
  // CITIZEN-ONLY. By design, only the citizen ends a consultation; the advocate's
  // recourse if a citizen cuts them off unfairly is to FILE A REPORT (see
  // reportCitizen), not to close. The room then becomes read-only and the advocate
  // is live-notified.
  async closeConsultation(consultationId: string, userId: string) {
    const existing = await this.db.query(
      `SELECT cr.request_id, cr.status, cr.citizen_id, cr.advocate_id,
              a.user_id AS advocate_user_id, a.name AS advocate_name,
              u.name AS citizen_name
       FROM consultation_request cr
       JOIN advocates a ON a.id = cr.advocate_id
       LEFT JOIN users u ON u.id = cr.citizen_id
       WHERE cr.request_id = $1`,
      [consultationId],
    );
    if (!existing.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    const row = existing.rows[0];
    // Only the citizen who owns this consultation may close it. Anyone else
    // (including the advocate on it) gets 404 — don't reveal the consultation.
    if (row.citizen_id !== userId) throw new NotFoundException('CONSULTATION_NOT_FOUND');
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

    const by = 'citizen' as const;
    const byName = row.citizen_name || 'The citizen';
    this.gateway.emitConsultationClosed(consultationId, { by, byName });

    return { consultationId, status: 'closed', by };
  }

  // ── POST /api/consultations/:id/report ───────────────────────────────────
  // Fairness counterweight to the citizen-can-close flow: once a consultation is
  // closed, the advocate on it may file ONE report against the citizen. The report
  // lands in the admin queue (status='open'). Advocate-only; closed-state only; the
  // unique index on consultation_id enforces the one-report rule.
  async reportCitizen(
    consultationId: string,
    userId: string,
    dto: ReportCitizenDto,
  ) {
    const existing = await this.db.query(
      `SELECT cr.request_id, cr.status, cr.citizen_id, cr.advocate_id,
              a.user_id AS advocate_user_id
       FROM consultation_request cr
       JOIN advocates a ON a.id = cr.advocate_id
       WHERE cr.request_id = $1`,
      [consultationId],
    );
    if (!existing.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    const row = existing.rows[0];
    // Only the advocate on this consultation can report. Citizens/strangers get 404
    // (don't reveal the consultation exists).
    if (row.advocate_user_id !== userId) {
      throw new NotFoundException('CONSULTATION_NOT_FOUND');
    }
    if (row.status !== 'closed') {
      throw new BadRequestException('Only closed consultations can be reported');
    }
    if (!row.citizen_id) {
      throw new BadRequestException('CONSULTATION_HAS_NO_CITIZEN');
    }

    try {
      const ins = await this.db.query(
        `INSERT INTO citizen_report
           (consultation_id, advocate_id, citizen_id, reason, note)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, status, created_at`,
        [consultationId, row.advocate_id, row.citizen_id, dto.reason, dto.note ?? null],
      );
      return {
        reportId: ins.rows[0].id,
        consultationId,
        status: ins.rows[0].status,
        createdAt: ins.rows[0].created_at,
      };
    } catch (err: any) {
      // 23505 = the unique index on consultation_id → already reported.
      if (err?.code === '23505') {
        throw new ConflictException('CONSULTATION_ALREADY_REPORTED');
      }
      throw err;
    }
  }
}
