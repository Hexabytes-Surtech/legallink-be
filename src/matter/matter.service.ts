import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AiService } from '../ai/ai.service';
import { MatchingService } from '../matching/matching.service';
import { CreateMatterDto } from './dto/create-matter.dto';

const DISCLAIMER =
  'This is legal information only, not legal advice. Please consult a qualified advocate for your specific situation.';

@Injectable()
export class MatterService {
  constructor(
    private db: DatabaseService,
    private ai: AiService,
    private matching: MatchingService,
  ) {}

  // ── POST /api/matter ─────────────────────────────────────────────────────
  async createMatter(dto: CreateMatterDto, citizenId: string | null) {
    if (!dto.query?.trim()) throw new BadRequestException('QUERY_REQUIRED');
    if (dto.query.trim().length > 2000) throw new BadRequestException('QUERY_TOO_LONG');
    if (!['bn', 'en'].includes(dto.language)) throw new BadRequestException('LANGUAGE_UNSUPPORTED');

    // 1 — Create matter row in Schema B table
    const insertResult = await this.db.query(
      `INSERT INTO matter
         (citizen_id, intake_text, intake_language, preferred_language, status, jurisdiction_state)
       VALUES ($1, $2, $3, $3, 'created', 'WB')
       RETURNING matter_id`,
      [citizenId, dto.query.trim(), dto.language],
    );
    const matterId: string = insertResult.rows[0].matter_id;

    // 2 — Run AI processing (mock or real) — writes classification + brief + citations to DB
    try {
      await this.ai.processMatter(matterId, dto.query.trim(), dto.language);
    } catch {
      // AI failure is non-fatal for Phase 1; return matter with null aiResponse
    }

    // 3 — Read back result
    return this.getMatterById(matterId, citizenId);
  }

  // ── GET /api/matter/:id ───────────────────────────────────────────────────
  async getMatterById(matterId: string, requesterId: string | null) {
    const matterResult = await this.db.query(
      `SELECT m.matter_id, m.intake_text, m.intake_language, m.status,
              m.classification_json, m.citizen_id, m.jurisdiction_district,
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

    // Authenticated users can only see their own matters (citizens or null anonymous)
    if (requesterId && row.citizen_id && row.citizen_id !== requesterId) {
      throw new NotFoundException('MATTER_NOT_FOUND');
    }

    // Fetch citations
    const citationResult = await this.db.query(
      `SELECT lu.act_name AS source, lu.section_number AS section,
              lu.section_title AS title, lu.text_content AS text, lu.citation
       FROM matter_citation mc
       JOIN legal_unit lu ON lu.unit_id = mc.unit_id
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

  // ── GET /api/matter/:id/advocates ─────────────────────────────────────────
  async getMatchingAdvocates(
    matterId: string,
    requesterId: string | null,
    page = 1,
    limit = 5,
  ) {
    if (limit > 20) limit = 20;

    const matterResult = await this.db.query(
      `SELECT matter_id, citizen_id, classification_json, jurisdiction_district,
              intake_language
       FROM matter WHERE matter_id = $1`,
      [matterId],
    );
    if (!matterResult.rows.length) throw new NotFoundException('MATTER_NOT_FOUND');
    const matter = matterResult.rows[0];

    if (requesterId && matter.citizen_id && matter.citizen_id !== requesterId) {
      throw new NotFoundException('MATTER_NOT_FOUND');
    }

    const matterType: string =
      matter.classification_json?.matterType ?? 'general';
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
