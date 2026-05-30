import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Express } from 'express';
import { DatabaseService } from '../database/database.service';
import { AiService } from '../ai/ai.service';
import { MatchingService } from '../matching/matching.service';
import { CreateMatterDto } from './dto/create-matter.dto';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CLOUDINARY_FOLDERS } from '../cloudinary/cloudinary.folders';

const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5 MB

// BUG-7: AI returns matterType in snake/slash form; advocate practice_areas use title-case labels.
const MATTER_TYPE_TO_PRACTICE_AREA: Record<string, string> = {
  motor_vehicle: 'Traffic',
  'motor_vehicle/traffic_offence': 'Traffic',
  traffic_offence: 'Traffic',
  tenancy_dispute: 'Tenancy',
  domestic_violence: 'Family',
  family: 'Family',
  cheque_bounce: 'Civil',
  civil: 'Civil',
  civil_dispute: 'Civil',
  property_dispute: 'Civil',
  property: 'Civil',
  consumer_complaint: 'Consumer',
  consumer: 'Consumer',
  consumer_dispute: 'Consumer',
  criminal_matter: 'Criminal',
  criminal: 'Criminal',
  criminal_offence: 'Criminal',
  labour_dispute: 'Labour',
  labour: 'Labour',
  labour_employment: 'Labour',
  employment: 'Labour',
  divorce: 'Family',
  maintenance: 'Family',
  dowry: 'Family',
};
const ALLOWED_DOC_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const DISCLAIMER =
  'This is legal information only, not legal advice. Please consult a qualified advocate for your specific situation.';

@Injectable()
export class MatterService {
  private readonly logger = new Logger(MatterService.name);

  constructor(
    private db: DatabaseService,
    private ai: AiService,
    private matching: MatchingService,
    private cloudinary: CloudinaryService,
  ) {}

  // ── POST /api/matter ─────────────────────────────────────────────────────
  async createMatter(
    dto: CreateMatterDto,
    citizenId: string | null,
    sessionId: string | null = null,
  ) {
    if (!dto.query?.trim()) throw new BadRequestException('QUERY_REQUIRED');
    const trimmedQuery = dto.query.trim();
    if (trimmedQuery.length < 20) throw new BadRequestException('QUERY_TOO_SHORT');
    if (trimmedQuery.length > 2000) throw new BadRequestException('QUERY_TOO_LONG');
    if (!['bn', 'en'].includes(dto.language)) throw new BadRequestException('LANGUAGE_UNSUPPORTED');

    // Only stamp session_id for anonymous matters — authenticated users own the row directly.
    const sessionForRow = citizenId ? null : sessionId;
    // Category 1B: anonymous matters expire after 3 days; claimed matters never expire.
    const expiresAt = citizenId ? null : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    // 1 — Create matter row in Schema B table
    const insertResult = await this.db.query(
      `INSERT INTO matter
         (citizen_id, session_id, intake_text, intake_language, preferred_language, status, jurisdiction_state, expires_at)
       VALUES ($1, $2, $3, $4, $4, 'created', 'WB', $5)
       RETURNING matter_id`,
      [citizenId, sessionForRow, trimmedQuery, dto.language, expiresAt],
    );
    const matterId: string = insertResult.rows[0].matter_id;

    // 2 — Run AI processing — writes classification + brief + citations to DB.
    // Failure is non-fatal (we still return the matter row), but we log every failure
    // so a missing AI brief never goes silent (fixes audit bug C1).
    try {
      await this.ai.processMatter(matterId, trimmedQuery, dto.language);
    } catch (err) {
      this.logger.error(
        `AI pipeline failed for matter=${matterId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      await this.db
        .query(
          `UPDATE matter SET status = 'ai_failed', updated_at = NOW() WHERE matter_id = $1`,
          [matterId],
        )
        .catch((dbErr: Error) =>
          this.logger.warn(`Could not mark matter ${matterId} as ai_failed: ${dbErr.message}`),
        );
    }

    // 3 — Read back result (forward sessionId so the new access check passes for
    // anonymous matters the caller just created).
    return this.getMatterById(matterId, citizenId, sessionForRow);
  }

  // ── GET /api/matter  (list for citizen) ──────────────────────────────────
  async listMattersForCitizen(citizenId: string) {
    const result = await this.db.query(
      `SELECT m.matter_id          AS "matterId",
              m.intake_text        AS query,
              m.intake_language    AS language,
              m.status,
              m.classification_json AS "classification",
              m.created_at         AS "createdAt",
              m.updated_at         AS "updatedAt",
              (SELECT cr.status FROM consultation_request cr
                 WHERE cr.matter_id = m.matter_id
                 ORDER BY cr.created_at DESC LIMIT 1) AS "consultationStatus",
              (SELECT cr.advocate_id FROM consultation_request cr
                 WHERE cr.matter_id = m.matter_id
                 ORDER BY cr.created_at DESC LIMIT 1) AS "advocateId"
         FROM matter m
        WHERE m.citizen_id = $1
        ORDER BY m.created_at DESC`,
      [citizenId],
    );
    return result.rows;
  }

  // ── GET /api/matter/:id ───────────────────────────────────────────────────
  async getMatterById(
    matterId: string,
    requesterId: string | null,
    sessionId: string | null = null,
  ) {
    const matterResult = await this.db.query(
      `SELECT m.matter_id, m.intake_text, m.intake_language, m.status,
              m.classification_json, m.citizen_id, m.session_id, m.jurisdiction_district,
              m.created_at,
              mbv.brief_json
       FROM matter m
       LEFT JOIN matter_brief_version mbv ON mbv.matter_id = m.matter_id
       WHERE m.matter_id = $1
       ORDER BY mbv.generated_at DESC
       LIMIT 1`,
      [matterId],
    );

    if (!matterResult.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');
    const row = matterResult.rows[0];

    // Access rules:
    //   1. Authenticated citizen: must own this matter (citizen_id match).
    //   2. Anonymous matter: requester's session cookie must match.
    //   3. BUG-3: Advocate with an accepted/pending consultation on this matter can also read it.
    if (row.citizen_id) {
      if (!requesterId || row.citizen_id !== requesterId) {
        // BUG-3: Secondary check — is the requester an advocate on this matter?
        if (requesterId) {
          const advocateAccess = await this.db.query(
            `SELECT cr.request_id FROM consultation_request cr
             JOIN advocates a ON a.id = cr.advocate_id
             WHERE cr.matter_id = $1 AND a.user_id = $2`,
            [matterId, requesterId],
          );
          if (!advocateAccess.rows.length) {
            throw new NotFoundException('MATTER_NOT_FOUND');
          }
        } else {
          throw new NotFoundException('MATTER_NOT_FOUND');
        }
      }
    } else {
      // Anonymous matter — must own the session.
      if (!sessionId || row.session_id !== sessionId) {
        throw new NotFoundException('MATTER_NOT_FOUND');
      }
    }

    // Fetch citations from legal_document_unit (the FK target of matter_citation).
    // Fall back to legal_unit only for legacy rows that may still point there.
    const citationResult = await this.db.query(
      `SELECT ldu.doc_title     AS source,
              ldu.node_label    AS section,
              ldu.doc_title     AS title,
              ldu.text_content  AS text,
              ldu.citation_text AS citation
         FROM matter_citation mc
         JOIN legal_document_unit ldu ON ldu.unit_id = mc.unit_id
        WHERE mc.matter_id = $1
        ORDER BY mc.relevance_score DESC`,
      [matterId],
    );

    const brief = row.brief_json;
    const classification = row.classification_json;

    return {
      matterId: row.matter_id,
      status: row.status,
      query: row.intake_text,
      language: row.intake_language,
      createdAt: row.created_at,
      aiResponse: brief
        ? {
            classification: classification ?? null,
            citations: citationResult.rows.map((c) => ({
              source: c.source,
              section: c.section,
              title: c.title,
              text: c.text?.slice(0, 400) ?? '',
              citation: c.citation,
            })),
            responseEnglish: brief.en_main_analysis ?? null,
            responseBengali: brief.bn_summary ?? null,
            procedural: Array.isArray(row.intake_language === 'bn' ? brief.bn_procedural : brief.en_procedural_steps)
              ? (row.intake_language === 'bn' ? brief.bn_procedural : brief.en_procedural_steps).join('\n')
              : (row.intake_language === 'bn' ? brief.bn_procedural : brief.en_procedural_steps) ?? null,
            nextSteps: Array.isArray(row.intake_language === 'bn' ? brief.bn_next_steps : brief.en_next_steps)
              ? (row.intake_language === 'bn' ? brief.bn_next_steps : brief.en_next_steps).join('\n')
              : (row.intake_language === 'bn' ? brief.bn_next_steps : brief.en_next_steps) ?? null,
            disclaimer: brief.notice ?? DISCLAIMER,
          }
        : null,
    };
  }

  // ── POST /api/matter/:id/documents ────────────────────────────────────────
  async uploadDocumentForMatter(
    matterId: string,
    file: Express.Multer.File,
    citizenUserId: string,
  ) {
    if (file.size > MAX_DOC_BYTES) throw new BadRequestException('FILE_TOO_LARGE');
    if (!ALLOWED_DOC_MIME.has(file.mimetype)) throw new BadRequestException('UNSUPPORTED_FILE_TYPE');

    // Verify matter exists and belongs to this citizen
    const m = await this.db.query(
      `SELECT matter_id, citizen_id FROM matter WHERE matter_id = $1`,
      [matterId],
    );
    if (!m.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');
    if (m.rows[0].citizen_id !== citizenUserId) {
      throw new ForbiddenException('MATTER_NOT_YOURS');
    }

    // Upload to Cloudinary
    const uploaded = await this.cloudinary.uploadFile(
      file,
      `${CLOUDINARY_FOLDERS.CITIZEN_DOCUMENTS}/${matterId}`,
    );
    const fileUrl = (uploaded as any).secure_url ?? (uploaded as any).url;
    if (!fileUrl) throw new BadRequestException('UPLOAD_FAILED');

    // Persist row
    const inserted = await this.db.query(
      `INSERT INTO documents (matter_id, uploader_id, file_path, file_type, size)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, matter_id, uploader_id, file_path, file_type, size, uploaded_at`,
      [matterId, citizenUserId, fileUrl, file.mimetype, file.size],
    );
    const row = inserted.rows[0];
    return {
      documentId: row.id,
      matterId: row.matter_id,
      fileUrl: row.file_path,
      fileType: row.file_type,
      size: row.size,
      uploadedAt: row.uploaded_at,
    };
  }

  // ── GET /api/matter/:id/advocates ─────────────────────────────────────────
  async getMatchingAdvocates(
    matterId: string,
    requesterId: string | null,
    page = 1,
    limit = 5,
    sessionId: string | null = null,
  ) {
    if (limit > 20) limit = 20;

    const matterResult = await this.db.query(
      `SELECT matter_id, citizen_id, session_id, classification_json, jurisdiction_district,
              intake_language
       FROM matter WHERE matter_id = $1`,
      [matterId],
    );
    if (!matterResult.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');
    const matter = matterResult.rows[0];

    // Same access rules as getMatterById
    if (matter.citizen_id) {
      if (!requesterId || matter.citizen_id !== requesterId) {
        throw new NotFoundException('MATTER_NOT_FOUND');
      }
    } else {
      if (!sessionId || matter.session_id !== sessionId) {
        throw new NotFoundException('MATTER_NOT_FOUND');
      }
    }

    const rawMatterType: string = matter.classification_json?.matterType ?? 'general';
    // BUG-7: Map AI-returned matterType to the practice_area label stored on advocates.
    const matterType: string = MATTER_TYPE_TO_PRACTICE_AREA[rawMatterType.toLowerCase()] ?? rawMatterType;
    const district: string | null = matter.jurisdiction_district ?? null;
    const language: string = matter.intake_language ?? 'en';

    const offset = (page - 1) * limit;
    const advocates = await this.matching.matchAdvocates(matterType, district, language, limit + offset);
    const paginated = advocates.slice(offset, offset + limit);

    return {
      advocates: paginated,
      total: advocates.length,
      page,
      pages: Math.ceil(advocates.length / limit),
    };
  }
}
