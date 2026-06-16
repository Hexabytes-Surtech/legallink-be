import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { ConversationGateway } from '../conversation/conversation.gateway';
import { NotificationsGateway } from '../conversation/notifications.gateway';
import { EmailService } from '../email/email.service';
import { CreateConsultationDto } from './dto/create-consultation.dto';
import { ReportCitizenDto } from './dto/report-citizen.dto';
import { UpdateStageDto, TIMELINE_STAGES } from './dto/update-stage.dto';
import { CloseConsultationDto } from './dto/close-consultation.dto';
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
    private notifications: NotificationsGateway,
    private email: EmailService,
    private config: ConfigService,
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
      `SELECT id, user_id, verification_status FROM advocates WHERE id = $1`,
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

    // Live nudge: light up the advocate's "Consultations" badge + refetch their list
    // in real time (their dashboard pending count too). Best-effort.
    this.notifications.emitDataChanged(advocateResult.rows[0].user_id, 'consultations', {
      kind: 'consultation_requested',
    });

    // Let the advocate know a citizen wants to consult them — email with the matter
    // details + a deep link to this request. Fire-and-forget: a mail hiccup must
    // never fail the request the citizen has already successfully created.
    this.notifyAdvocateOfRequest(
      row.request_id,
      dto.matterId,
      dto.advocateId,
      citizenUserId,
      scheduledAt,
      dto.citizenNote ?? null,
    ).catch(() => {});

    return {
      consultationId: row.request_id,
      status: row.status,
      matterId: row.matter_id,
      advocateId: row.advocate_id,
      createdAt: row.created_at,
    };
  }

  /**
   * Build and send the "new consultation request" notification to the advocate.
   * Pulls the advocate contact email, the citizen's display name and the matter
   * text/category in a single query, then hands a fully-formed payload to the
   * EmailService. Best-effort — callers invoke this without awaiting.
   */
  private async notifyAdvocateOfRequest(
    consultationId: string,
    matterId: string,
    advocateId: string,
    citizenUserId: string,
    scheduledAt: Date | null,
    citizenNote: string | null,
  ): Promise<void> {
    const res = await this.db.query(
      `SELECT a.name AS advocate_name,
              COALESCE(u.email, a.email) AS advocate_email,
              m.intake_text, m.classification_json,
              COALESCE(cu.name, 'A citizen') AS citizen_name
       FROM advocates a
       JOIN users u ON u.id = a.user_id
       JOIN matter m ON m.matter_id = $2
       LEFT JOIN users cu ON cu.id = $3
       WHERE a.id = $1`,
      [advocateId, matterId, citizenUserId],
    );
    if (!res.rows.length || !res.rows[0].advocate_email) return;
    const r = res.rows[0];

    const viewUrl = `${this.frontendBaseUrl()}/advocate/consultations/${consultationId}`;
    await this.email.sendConsultationRequested(r.advocate_email, {
      advocateName: r.advocate_name || 'Advocate',
      citizenName: r.citizen_name,
      category: this.humanizeMatterType(r.classification_json?.matterType),
      matterSummary:
        this.truncate(r.intake_text, 320) ||
        'A new legal matter (no description was provided).',
      citizenNote,
      scheduledAtLabel: scheduledAt ? this.formatIstLabel(scheduledAt) : null,
      viewUrl,
    });
  }

  /** Frontend origin for email deep links: FRONTEND_URL → first CORS origin → localhost. */
  private frontendBaseUrl(): string {
    const explicit = this.config.get<string>('FRONTEND_URL');
    if (explicit && explicit.trim()) return explicit.trim().replace(/\/+$/, '');
    const first = (this.config.get<string>('CORS_ORIGIN') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    return (first || 'http://localhost:3000').replace(/\/+$/, '');
  }

  /** Trim to `max` chars on a word-ish boundary, appending an ellipsis when cut. */
  private truncate(text: string | null, max: number): string {
    if (!text) return '';
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
  }

  /** Slugged AI matter type → readable label, e.g. "criminal_matter" → "Criminal Matter". */
  private humanizeMatterType(raw: unknown): string | null {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    return raw.trim().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /** UTC instant → friendly IST label, e.g. "16 Jun 2026, 14:30 IST". */
  private formatIstLabel(instant: Date): string {
    const { date, time } = instantToIstParts(instant);
    const [y, mo, d] = date.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[mo - 1]} ${y}, ${time} IST`;
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
              au.avatar_url AS "advocateAvatarUrl",
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
       LEFT JOIN users au ON au.id = a.user_id
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

  // ── GET /api/consultations/:id/timeline ──────────────────────────────────
  // Both participants. The advocate edits the timeline (PUT :id/stage and the close
  // flow); the citizen sees it read-only on the frontend. Ownership is the same dual
  // check getConsultation uses: own citizen_id OR own one of this user's advocate ids.
  /**
   * List the uploaded documents of the matter behind a consultation. Readable by
   * EITHER participant (the citizen who owns the matter, or the advocate on the
   * consultation) — so the advocate can review the citizen's evidence during the chat
   * without exposing the owner-gated /matter/:id/documents route to non-owners.
   */
  async getMatterDocuments(consultationId: string, userId: string) {
    const access = await this.db.query(
      `SELECT cr.matter_id
         FROM consultation_request cr
        WHERE cr.request_id = $1
          AND (cr.citizen_id = $2 OR cr.advocate_id IN (
                SELECT id FROM advocates WHERE user_id = $2
              ))`,
      [consultationId, userId],
    );
    if (!access.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');

    const docs = await this.db.query(
      `SELECT id           AS "documentId",
              matter_id     AS "matterId",
              file_path     AS "fileUrl",
              file_type     AS "fileType",
              size,
              uploaded_at   AS "uploadedAt"
         FROM documents
        WHERE matter_id = $1
        ORDER BY uploaded_at ASC`,
      [access.rows[0].matter_id],
    );
    return docs.rows;
  }

  async getTimeline(consultationId: string, userId: string) {
    const result = await this.db.query(
      `SELECT cr.request_id AS "consultationId", cr.status,
              cr.current_stage AS "currentStage",
              cr.closure_outcome AS "closureOutcome", cr.closure_summary AS "closureSummary",
              cr.closure_settlement AS "closureSettlement",
              cr.closure_new_advocate AS "closureNewAdvocate",
              cr.closure_noc_issued AS "closureNocIssued",
              cr.closure_next_steps AS "closureNextSteps",
              cr.documents_returned AS "documentsReturned", cr.fees_settled AS "feesSettled",
              cr.closed_at AS "closedAt", cr.created_at AS "createdAt", cr.updated_at AS "updatedAt",
              a.name AS "advocateName", a.bar_enrolment_number AS "barEnrolmentNumber",
              u.name AS "citizenName"
       FROM consultation_request cr
       JOIN advocates a ON a.id = cr.advocate_id
       LEFT JOIN users u ON u.id = cr.citizen_id
       WHERE cr.request_id = $1
         AND (cr.citizen_id = $2 OR cr.advocate_id IN (
               SELECT id FROM advocates WHERE user_id = $2
             ))`,
      [consultationId, userId],
    );
    if (!result.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    const c = result.rows[0];

    const ev = await this.db.query(
      `SELECT event_id AS "eventId", stage_key AS "stageKey", note,
              actor_type AS "actorType", created_at AS "createdAt"
       FROM consultation_timeline_event
       WHERE consultation_id = $1
       ORDER BY created_at ASC, event_id ASC`,
      [consultationId],
    );
    let events = ev.rows;
    // Synthetic baseline so the read-only view is never empty for an accepted/closed
    // consultation whose rows predate the timeline table (belt-and-braces over the
    // 026 backfill).
    if (!events.length && (c.status === 'accepted' || c.status === 'closed')) {
      events = [
        {
          eventId: `baseline-${c.consultationId}`,
          stageKey: 'consultation_started',
          note: null,
          actorType: 'system',
          createdAt: c.updatedAt ?? c.createdAt,
        },
      ];
    }

    const closure =
      c.status === 'closed'
        ? {
            outcomeKey: c.closureOutcome,
            summary: c.closureSummary,
            settlement: c.closureSettlement,
            newAdvocate: c.closureNewAdvocate,
            nocIssued: c.closureNocIssued,
            nextSteps: c.closureNextSteps,
            documentsReturned: c.documentsReturned,
            feesSettled: c.feesSettled,
            closedAt: c.closedAt,
            advocateName: c.advocateName,
            barEnrolmentNumber: c.barEnrolmentNumber,
            citizenName: c.citizenName,
          }
        : null;

    return {
      consultationId: c.consultationId,
      status: c.status,
      currentStage: c.currentStage,
      closure,
      events,
    };
  }

  // ── PUT /api/consultations/:id/stage ─────────────────────────────────────
  // ADVOCATE-ONLY. The advocate on this consultation advances (or corrects) the case
  // stage while it is 'accepted'. 'closed' cannot be set here — that's the close flow,
  // which also records the closure outcome. One transaction: append a dated event +
  // update current_stage + drop an audit breadcrumb on the matter; then live-broadcast
  // so the citizen's read-only timeline updates without a reload.
  async updateStage(consultationId: string, userId: string, dto: UpdateStageDto) {
    if (!TIMELINE_STAGES.includes(dto.stageKey)) {
      throw new BadRequestException('INVALID_STAGE');
    }
    const existing = await this.db.query(
      `SELECT cr.request_id, cr.status, cr.matter_id
       FROM consultation_request cr
       WHERE cr.request_id = $1
         AND cr.advocate_id IN (SELECT id FROM advocates WHERE user_id = $2)`,
      [consultationId, userId],
    );
    if (!existing.rows.length) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    const row = existing.rows[0];
    if (row.status !== 'accepted') {
      throw new BadRequestException('Only accepted consultations can have their stage updated');
    }

    const event = await this.db.withTransaction(async (q) => {
      const ins = await q(
        `INSERT INTO consultation_timeline_event
           (consultation_id, stage_key, note, actor_type, actor_id)
         VALUES ($1, $2, $3, 'advocate', $4)
         RETURNING event_id, stage_key, note, actor_type, created_at`,
        [consultationId, dto.stageKey, dto.note?.trim() || null, userId],
      );
      await q(
        `UPDATE consultation_request SET current_stage = $1, updated_at = NOW()
         WHERE request_id = $2`,
        [dto.stageKey, consultationId],
      );
      // Additive admin/audit breadcrumb (matter_event already exists, no consumers).
      await q(
        `INSERT INTO matter_event (matter_id, event_type, payload, actor_type)
         VALUES ($1, 'timeline_stage_changed', $2, 'advocate')`,
        [row.matter_id, JSON.stringify({ consultationId, stageKey: dto.stageKey })],
      );
      return ins.rows[0];
    });

    const payload = {
      eventId: event.event_id,
      stageKey: event.stage_key,
      note: event.note,
      actorType: event.actor_type,
      createdAt: event.created_at,
    };
    this.gateway.emitTimelineUpdated(consultationId, {
      currentStage: dto.stageKey,
      event: payload,
    });

    return { consultationId, currentStage: dto.stageKey, event: payload };
  }

  // ── PUT /api/consultations/:id/close ─────────────────────────────────────
  // Role-aware close.
  //   • CITIZEN — their absolute right to withdraw/discharge: closes with the forced
  //     outcome 'withdrawn_by_client'; summary optional. (The advocate's counterweight
  //     to an unfair close remains reportCitizen.)
  //   • ADVOCATE — issues the Consultation Closure Summary: must supply an outcome and a
  //     written summary, plus optional conditional fields and the two BCI duty flags
  //     (documents returned, fees settled).
  // Either way the room goes read-only (consultation_closed) and the timeline gets a
  // dated terminal 'closed' event.
  async closeConsultation(
    consultationId: string,
    userId: string,
    role: string,
    dto: CloseConsultationDto = {},
  ) {
    const existing = await this.db.query(
      `SELECT cr.request_id, cr.status, cr.matter_id, cr.citizen_id, cr.advocate_id,
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
    // Only the citizen who owns this consultation OR the advocate on it may close.
    // Anyone else gets 404 — don't reveal the consultation.
    const isCitizen = !!row.citizen_id && row.citizen_id === userId;
    const isAdvocate = row.advocate_user_id === userId;
    if (!isCitizen && !isAdvocate) throw new NotFoundException('CONSULTATION_NOT_FOUND');
    if (row.status !== 'accepted') {
      throw new BadRequestException('Only accepted consultations can be closed');
    }

    // Treat as an advocate close only when the actor is the advocate (and not also the
    // citizen, which can't happen in practice but is handled defensively).
    const advocateClose = isAdvocate && !isCitizen;

    let outcome: string;
    let summary: string | null;
    let settlement: string | null = null;
    let newAdvocate: string | null = null;
    let nocIssued: boolean | null = null;
    let nextSteps: string | null = null;
    let documentsReturned = false;
    let feesSettled = false;

    if (advocateClose) {
      if (!dto.outcomeKey) throw new BadRequestException('CLOSURE_OUTCOME_REQUIRED');
      if (!dto.summary || !dto.summary.trim()) {
        throw new BadRequestException('CLOSURE_SUMMARY_REQUIRED');
      }
      outcome = dto.outcomeKey;
      summary = dto.summary.trim();
      settlement = dto.settlement?.trim() || null;
      newAdvocate = dto.newAdvocate?.trim() || null;
      nocIssued = dto.nocIssued ?? null;
      nextSteps = dto.nextSteps?.trim() || null;
      documentsReturned = dto.documentsReturned ?? false;
      feesSettled = dto.feesSettled ?? false;
    } else {
      // Citizen withdrawal — forced outcome; an optional note is allowed.
      outcome = 'withdrawn_by_client';
      summary = dto.summary?.trim() || null;
    }

    const by = (advocateClose ? 'advocate' : 'citizen') as 'advocate' | 'citizen';
    // citizen_read: TRUE when the citizen is the actor (they've seen it); FALSE on an
    // advocate close so the citizen's list lights up with the new closure.
    const citizenRead = by === 'citizen';

    const event = await this.db.withTransaction(async (q) => {
      await q(
        `UPDATE consultation_request
         SET status = 'closed', current_stage = 'closed', closed_at = NOW(),
             citizen_read = $2, updated_at = NOW(),
             closure_outcome = $3, closure_summary = $4, closure_settlement = $5,
             closure_new_advocate = $6, closure_noc_issued = $7, closure_next_steps = $8,
             documents_returned = $9, fees_settled = $10
         WHERE request_id = $1`,
        [
          consultationId,
          citizenRead,
          outcome,
          summary,
          settlement,
          newAdvocate,
          nocIssued,
          nextSteps,
          documentsReturned,
          feesSettled,
        ],
      );
      // C-2: closing also completes any still-scheduled appointment so it doesn't get
      // stuck on 'scheduled' forever.
      await q(
        `UPDATE consultation_appointment
         SET status = 'completed', updated_at = NOW()
         WHERE consultation_id = $1 AND status = 'scheduled'`,
        [consultationId],
      );
      // Terminal timeline event. Note stays NULL — the full summary lives in the
      // closure columns (rendered as the Closure Summary card), not duplicated here.
      const ins = await q(
        `INSERT INTO consultation_timeline_event
           (consultation_id, stage_key, note, actor_type, actor_id)
         VALUES ($1, 'closed', NULL, $2, $3)
         RETURNING event_id, stage_key, note, actor_type, created_at`,
        [consultationId, by, userId],
      );
      await q(
        `INSERT INTO matter_event (matter_id, event_type, payload, actor_type)
         VALUES ($1, 'consultation_closed', $2, $3)`,
        [row.matter_id, JSON.stringify({ consultationId, outcome, by }), by],
      );
      return ins.rows[0];
    });

    const byName =
      by === 'advocate'
        ? row.advocate_name || 'The advocate'
        : row.citizen_name || 'The citizen';
    this.gateway.emitConsultationClosed(consultationId, { by, byName });
    this.gateway.emitTimelineUpdated(consultationId, {
      currentStage: 'closed',
      event: {
        eventId: event.event_id,
        stageKey: event.stage_key,
        note: event.note,
        actorType: event.actor_type,
        createdAt: event.created_at,
      },
      closed: true,
    });

    // Refresh the OTHER party's consultation list/dashboard live (the actor's own
    // client already refetches off the action response). The /ws close event above
    // only reaches whoever is sitting in the chat room — this covers their lists.
    const otherParty = by === 'citizen' ? row.advocate_user_id : row.citizen_id;
    this.notifications.emitDataChanged(otherParty, 'consultations', {
      kind: 'consultation_closed',
    });

    return { consultationId, status: 'closed', by, outcomeKey: outcome };
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
      // Light up the admin "Reports" queue live for every connected admin.
      this.notifications.emitDataChangedToRole('admin', 'admin-reports', {
        kind: 'report_filed',
      });

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
