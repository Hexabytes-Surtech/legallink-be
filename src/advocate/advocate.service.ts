import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { EmailService } from '../email/email.service';
import { NotificationsGateway } from '../conversation/notifications.gateway';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AdvocatesQueryDto } from './dto/advocates-query.dto';

// Canonical practice-area vocabulary (matches FE constants + public directory filter).
const CANONICAL_PRACTICE_AREAS = new Set(['Criminal','Civil','Family','Labour','Tenancy','Traffic','Consumer']);
// Normalise any stored or incoming practice_area label to the canonical Title Case form.
const PA_NORMALISE: Record<string,string> = {
  criminal_matter:'Criminal', criminal:'Criminal', criminal_offence:'Criminal',
  civil_dispute:'Civil', civil:'Civil', cheque_bounce:'Civil', property_dispute:'Civil', property:'Civil',
  family_law:'Family', domestic_violence:'Family', divorce:'Family', maintenance:'Family', dowry:'Family',
  labour_dispute:'Labour', labour_law:'Labour', labour:'Labour', labour_employment:'Labour', employment:'Labour', workplace_harassment:'Labour',
  tenancy_dispute:'Tenancy', tenancy:'Tenancy',
  'motor_vehicle/traffic_offence':'Traffic', motor_vehicle:'Traffic', traffic_offence:'Traffic',
  consumer_complaint:'Consumer', consumer_dispute:'Consumer', consumer:'Consumer',
  corporate:'Civil', corporate_law:'Civil', family:'Family',
};
function normalisePracticeAreas(areas: string[] | undefined): string[] | undefined {
  if (!areas) return undefined;
  const mapped = areas.map(a => {
    if (CANONICAL_PRACTICE_AREAS.has(a)) return a;
    return PA_NORMALISE[a.toLowerCase()] ?? a;
  });
  // Different slugs can collapse to the same bucket — dedupe so the stored array
  // doesn't contain repeats (which render as duplicate badges / duplicate React keys).
  return Array.from(new Set(mapped));
}

@Injectable()
export class AdvocateService {
  constructor(
    private db: DatabaseService,
    private cloudinaryService: CloudinaryService,
    private emailService: EmailService,
    private notifications: NotificationsGateway,
  ) {}

  // ── GET /api/advocate/me ───────────────────────────────────────────────
  async getMe(userId: string) {
    const result = await this.db.query(
      `SELECT a.id AS advocate_id, a.name, a.address, a.phone, a.email AS advocate_email,
              a.bar_enrolment_number, a.state_bar, a.bio,
              a.practice_areas, a.courts, a.languages, a.districts,
              a.verification_status, a.rejection_reason, a.created_at, a.updated_at,
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

    // Credentials that were vetted at verification (bar enrolment number + state bar)
    // are immutable once verified — otherwise a 'verified' advocate could swap in
    // someone else's number and the public directory would vouch for an unchecked
    // credential. A no-op write of the same value is allowed.
    if (advocate.verification_status === 'verified') {
      const changingBar =
        dto.barEnrolmentNumber !== undefined &&
        dto.barEnrolmentNumber !== advocate.bar_enrolment_number;
      const changingStateBar =
        dto.stateBar !== undefined && dto.stateBar !== advocate.state_bar;
      if (changingBar || changingStateBar) {
        throw new BadRequestException('CREDENTIALS_LOCKED_AFTER_VERIFICATION');
      }
    }

    // Full name is set ONCE during onboarding (while still 'pending') and is then
    // frozen — it can never be changed afterwards (the profile page also hides it).
    // Silently ignore any name change once the advocate has moved past 'pending'.
    const nameLocked = advocate.verification_status !== 'pending';

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const fieldMap: Record<string, any> = {
      name: nameLocked ? undefined : dto.name,
      address: dto.address,
      phone: dto.phone,
      email: dto.email,
      bio: dto.bio,
      bar_enrolment_number: dto.barEnrolmentNumber,
      state_bar: dto.stateBar,
      practice_areas: normalisePracticeAreas(dto.practiceAreas),
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
              cr.citizen_id AS citizen_user_id,
              COALESCE(u.name, 'Citizen') AS citizen_name,
              u.avatar_url AS citizen_avatar_url,
              EXISTS(SELECT 1 FROM citizen_report rep WHERE rep.consultation_id = cr.request_id) AS reported,
              (SELECT COUNT(*)::int FROM conversation_message cm
                WHERE cm.request_id = cr.request_id
                  AND cm.sender_type = 'citizen'
                  AND cm.deleted_at IS NULL
                  AND cm.moderation_status = 'cleared'
                  AND (cr.advocate_last_read_at IS NULL OR cm.created_at > cr.advocate_last_read_at)
              ) AS "unreadCount"
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       LEFT JOIN users u ON u.id = cr.citizen_id
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
              cr.citizen_id AS citizen_user_id,
              COALESCE(u.name, 'Citizen') AS citizen_name,
              u.avatar_url AS citizen_avatar_url
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       LEFT JOIN users u ON u.id = cr.citizen_id
       LEFT JOIN matter_brief_version mbv ON mbv.matter_id = m.matter_id
       WHERE cr.request_id = $1 AND cr.advocate_id = $2
       ORDER BY mbv.generated_at DESC
       LIMIT 1`,
      [consultationId, advocate.id],
    );
    if (!result.rows.length) throw new NotFoundException('Consultation not found');
    const row = result.rows[0];

    // Opening the consultation marks it read for the advocate — advance the read
    // position so their numeric unread badge for this chat clears.
    await this.db.query(
      `UPDATE consultation_request SET advocate_last_read_at = NOW()
       WHERE request_id = $1 AND advocate_id = $2`,
      [consultationId, advocate.id],
    );

    // The raw brief_json (Gemini/RAG shape) doesn't match the frontend AiBrief's
    // AiResponse shape — it has no `citations` and uses different keys. Normalise it
    // the same way matter.getMatterById does so the advocate's brief renders (and
    // doesn't crash on `citations.length`).
    row.brief_json = await this.normaliseBrief(row.matter_id, row.brief_json, row.classification, row.query_language === 'bn');

    return row;
  }

  /** Map a raw brief_json + the matter's citations into the FE AiResponse shape. */
  private async normaliseBrief(matterId: string, brief: any, classification: any, isBn: boolean) {
    if (!brief) return null;
    const citationResult = await this.db.query(
      `SELECT ldu.doc_title AS source, ldu.node_label AS section, ldu.doc_title AS title,
              ldu.text_content AS text, ldu.citation_text AS citation
         FROM matter_citation mc
         JOIN legal_document_unit ldu ON ldu.unit_id = mc.unit_id
        WHERE mc.matter_id = $1
        ORDER BY mc.relevance_score DESC`,
      [matterId],
    );
    const joinList = (v: unknown): string | null =>
      Array.isArray(v) ? v.join('\n') : typeof v === 'string' && v.trim() ? v : null;
    const proceduralRaw = isBn ? brief?.bn_procedural : (brief?.en_procedural_steps ?? brief?.procedural_information);
    const nextStepsRaw = isBn ? brief?.bn_next_steps : (brief?.en_next_steps ?? brief?.missing_information);
    return {
      classification: classification ?? null,
      citations: citationResult.rows.map((c) => ({
        source: c.source,
        section: c.section,
        title: c.title,
        text: c.text?.slice(0, 400) ?? '',
        citation: c.citation,
      })),
      responseEnglish: brief.en_main_analysis ?? brief.matter_summary ?? null,
      responseBengali: brief.bn_summary ?? null,
      procedural: joinList(proceduralRaw),
      nextSteps: joinList(nextStepsRaw),
      disclaimer: brief.notice ?? null,
    };
  }

  async updateConsultation(
    userId: string,
    consultationId: string,
    action: 'accept' | 'decline',
    declineReason?: string,
  ) {
    const advocate = await this.getAdvocateByUserId(userId);
    const existing = await this.db.query(
      `SELECT cr.request_id, cr.status, cr.citizen_id,
              m.intake_text AS matter_summary,
              u.email AS citizen_email
       FROM consultation_request cr
       JOIN matter m ON m.matter_id = cr.matter_id
       LEFT JOIN users u ON u.id = cr.citizen_id
       WHERE cr.request_id = $1 AND cr.advocate_id = $2`,
      [consultationId, advocate.id],
    );
    if (!existing.rows.length) throw new NotFoundException('Consultation not found');
    if (existing.rows[0].status !== 'pending')
      throw new BadRequestException('Consultation is not in pending state');

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const advocateNote = declineReason ?? null;

    // Atomic state transition. The `AND status = 'pending'` + rowCount check closes
    // the accept/decline TOCTOU: a racing second request (double-click, or accept+
    // decline race) finds status already changed and updates 0 rows, so we never
    // send two contradictory emails or let a decline overwrite an accept.
    const updatedRows = await this.db.withTransaction(async (q) => {
      // Category 4: Set citizen_read=FALSE so citizen's badge lights up.
      const upd = await q(
        `UPDATE consultation_request
         SET status = $1, advocate_note = $2, citizen_read = FALSE, updated_at = NOW()
         WHERE request_id = $3 AND status = 'pending'`,
        [newStatus, advocateNote, consultationId],
      );
      // C-2: declining frees any slot this request had booked, so the appointment
      // doesn't stay 'scheduled' (and the advocate's time blocked) forever.
      if ((upd.rowCount ?? 0) > 0 && action === 'decline') {
        await q(
          `UPDATE consultation_appointment
           SET status = 'cancelled', updated_at = NOW()
           WHERE consultation_id = $1 AND status = 'scheduled'`,
          [consultationId],
        );
      }
      // Accepting opens the case timeline at its first stage. consultation_request
      // already defaults current_stage='consultation_started'; this seeds the matching
      // dated event so the citizen's read-only timeline isn't empty.
      if ((upd.rowCount ?? 0) > 0 && action === 'accept') {
        await q(
          `INSERT INTO consultation_timeline_event
             (consultation_id, stage_key, actor_type, actor_id)
           VALUES ($1, 'consultation_started', 'advocate', $2)`,
          [consultationId, userId],
        );
      }
      return upd.rowCount ?? 0;
    });

    if (updatedRows === 0) {
      throw new BadRequestException('Consultation is not in pending state');
    }

    // Category 5: Notify citizen by email (non-fatal).
    const { citizen_email, citizen_id, matter_summary } = existing.rows[0];
    if (citizen_email) {
      if (action === 'accept') {
        this.emailService
          .sendConsultationAccepted(citizen_email, advocate.name ?? 'Your advocate', matter_summary ?? '')
          .catch(() => {});
      } else {
        this.emailService
          .sendConsultationDeclined(citizen_email, advocate.name ?? 'Your advocate', declineReason)
          .catch(() => {});
      }
    }

    // Live nudge: the citizen's consultation list + dashboard reflect the new status
    // (accepted/declined) without a refresh, and their "Consultations" badge lights up.
    this.notifications.emitDataChanged(citizen_id, 'consultations', {
      kind: action === 'accept' ? 'consultation_accepted' : 'consultation_declined',
    });

    return { consultationId, status: newStatus, ...(declineReason && { declineReason }) };
  }

  async getDashboard(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    const [stats, rating] = await Promise.all([
      this.db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'pending')   AS pending_count,
           COUNT(*) FILTER (WHERE status = 'accepted')  AS accepted_count,
           COUNT(*) FILTER (WHERE status = 'declined')  AS declined_count,
           COUNT(*) FILTER (WHERE status = 'closed')    AS closed_count,
           COUNT(*)                                      AS total_count
         FROM consultation_request WHERE advocate_id = $1`,
        [advocate.id],
      ),
      this.db.query(
        `SELECT ROUND(AVG(rating)::numeric, 1) AS average_rating
         FROM consultation_feedback WHERE advocate_id = $1 AND is_visible = true`,
        [advocate.id],
      ),
    ]);
    return {
      advocateId: advocate.id,
      verificationStatus: advocate.verification_status,
      rejectionReason: advocate.rejection_reason ?? null,
      profileCompleteness: this.calculateProfileCompleteness(advocate),
      consultationStats: stats.rows[0],
      averageRating: rating.rows[0].average_rating
        ? parseFloat(rating.rows[0].average_rating)
        : null,
    };
  }

  async submitVerification(userId: string) {
    const advocate = await this.getAdvocateByUserId(userId);
    if (advocate.verification_status === 'verified')
      throw new BadRequestException('Already verified');
    if (advocate.verification_status === 'submitted')
      throw new BadRequestException('Already submitted for review');
    if (!advocate.bar_enrolment_number || !advocate.state_bar || !advocate.name || !advocate.address)
      throw new BadRequestException('Complete your profile before submitting for verification');

    // BUG-1: Actually update the DB — the previous code only returned a message without writing anything.
    await this.db.query(
      `UPDATE advocates
       SET verification_status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [advocate.id],
    );

    // A new application just landed in the admin verification queue — light it up
    // live for every connected admin.
    this.notifications.emitDataChangedToRole('admin', 'admin-advocates', {
      kind: 'advocate_submitted',
    });

    return {
      advocateId: advocate.id,
      verificationStatus: 'submitted',
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
    // Free-text search ($5) — matched case-insensitively against name, bio, state
    // bar, and the practice-area / district arrays. NULL (no `q`) disables it.
    const search =
      typeof query.q === 'string' && query.q.trim() ? query.q.trim() : null;

    const filterParams = [verifiedOnly, practiceAreas, languages, district, search];

    const rows = await this.db.query(
      `SELECT a.id, a.name, a.bio, a.practice_areas, a.languages, a.districts,
              a.state_bar, a.verification_status, u.avatar_url,
              ROUND(AVG(cf.rating)::numeric, 1) AS rating,
              COUNT(cf.id)::int AS rating_count
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN consultation_feedback cf ON cf.advocate_id = a.id AND cf.is_visible = true
       WHERE ($1 = false OR a.verification_status = 'verified')
         AND ($2::text[] IS NULL OR a.practice_areas && $2::text[])
         AND ($3::text[] IS NULL OR a.languages && $3::text[])
         AND ($4::text IS NULL OR $4 = ANY(a.districts))
         AND ($5::text IS NULL
              OR a.name ILIKE '%' || $5 || '%'
              OR a.bio ILIKE '%' || $5 || '%'
              OR a.state_bar ILIKE '%' || $5 || '%'
              OR EXISTS (SELECT 1 FROM unnest(a.practice_areas) pa WHERE pa ILIKE '%' || $5 || '%')
              OR EXISTS (SELECT 1 FROM unnest(a.districts) d WHERE d ILIKE '%' || $5 || '%'))
       GROUP BY a.id, u.avatar_url
       ORDER BY (a.verification_status = 'verified') DESC, a.name ASC
       LIMIT $6 OFFSET $7`,
      [...filterParams, limit, offset],
    );

    const countResult = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM advocates a
       WHERE ($1 = false OR a.verification_status = 'verified')
         AND ($2::text[] IS NULL OR a.practice_areas && $2::text[])
         AND ($3::text[] IS NULL OR a.languages && $3::text[])
         AND ($4::text IS NULL OR $4 = ANY(a.districts))
         AND ($5::text IS NULL
              OR a.name ILIKE '%' || $5 || '%'
              OR a.bio ILIKE '%' || $5 || '%'
              OR a.state_bar ILIKE '%' || $5 || '%'
              OR EXISTS (SELECT 1 FROM unnest(a.practice_areas) pa WHERE pa ILIKE '%' || $5 || '%')
              OR EXISTS (SELECT 1 FROM unnest(a.districts) d WHERE d ILIKE '%' || $5 || '%'))`,
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
              u.avatar_url,
              ROUND(AVG(cf.rating)::numeric, 1) AS rating,
              COUNT(cf.id)::int AS rating_count,
              -- Scalar subquery (not a join) so it can't fan out the rating AVG/COUNT.
              (SELECT COALESCE(
                  json_agg(json_build_object('id', d.id, 'fileUrl', d.file_path, 'fileType', d.file_type)
                           ORDER BY d.uploaded_at DESC),
                  '[]'::json)
                FROM advocate_verification_documents d WHERE d.advocate_id = a.id) AS documents
       FROM advocates a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN consultation_feedback cf ON cf.advocate_id = a.id AND cf.is_visible = true
       WHERE a.id = $1
       GROUP BY a.id, u.avatar_url`,
      [id],
    );
    if (!result.rows.length) {
      throw new NotFoundException('Advocate not found');
    }
    const row = result.rows[0];
    // Verification documents are exposed to citizens ONLY for verified advocates —
    // they're the proven credentials behind the verification. Hidden otherwise.
    if (row.verification_status !== 'verified') row.documents = [];
    return row;
  }

  // ── Private Helpers ───────────────────────────────────────────────────

  private async getAdvocateByUserId(userId: string) {
    const result = await this.db.query(
      `SELECT id, name, address, phone, email,
              bar_enrolment_number, state_bar, bio,
              practice_areas, courts, languages, districts,
              verification_status, rejection_reason
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
              a.bar_enrolment_number, a.state_bar, a.bio,
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
