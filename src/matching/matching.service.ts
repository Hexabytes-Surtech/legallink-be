import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// Mirrors the public advocate-directory card shape (see AdvocateService.listPublic)
// so the frontend AdvocateCard renders matter matches and directory results identically.
export interface AdvocateMatch {
  id: string;
  name: string;
  bio: string | null;
  practice_areas: string[];
  languages: string[];
  districts: string[];
  state_bar: string | null;
  verification_status: string;
  avatar_url: string | null;
  rating: string | null;
  rating_count: number;
}

// Columns selected for the advocate card — kept identical to the public directory.
const CARD_COLUMNS = `
  a.id, a.name, a.bio, a.practice_areas, a.languages, a.districts,
  a.state_bar, a.verification_status, u.avatar_url,
  ROUND(AVG(cf.rating)::numeric, 1) AS rating,
  COUNT(cf.id)::int AS rating_count`;

const CARD_JOINS = `
  FROM advocates a
  LEFT JOIN users u ON u.id = a.user_id
  LEFT JOIN consultation_feedback cf ON cf.advocate_id = a.id AND cf.is_visible = true`;

@Injectable()
export class MatchingService {
  constructor(private db: DatabaseService) {}

  // Finds verified advocates whose practice areas overlap with the matter type.
  // candidateTerms should include both the raw AI matterType AND the canonical Title Case label
  // so advocates stored with either form are matched (DB has mixed formats from seed data).
  async matchAdvocates(
    candidateTerms: string[],
    district: string | null,
    language: string,
    limit = 5,
  ): Promise<AdvocateMatch[]> {
    // Build a flexible query: practice_areas match is required;
    // district + language matches boost results via ordering but are not hard filters
    // so citizens in areas with few advocates still see results.
    const result = await this.db.query(
      `SELECT ${CARD_COLUMNS},
         (CASE WHEN a.districts && ARRAY[$2]::text[] THEN 1 ELSE 0 END +
          CASE WHEN a.languages && ARRAY[$3]::text[] THEN 1 ELSE 0 END) AS relevance
       ${CARD_JOINS}
       WHERE a.verification_status = 'verified'
         AND a.practice_areas && $1::text[]
       GROUP BY a.id, u.avatar_url
       ORDER BY relevance DESC, a.updated_at DESC
       LIMIT $4`,
      [candidateTerms, district ?? '', language, limit],
    );

    // If nothing matches on practice_areas, fall back to all verified advocates
    if (!result.rows.length) {
      const fallback = await this.db.query(
        `SELECT ${CARD_COLUMNS}
         ${CARD_JOINS}
         WHERE a.verification_status = 'verified'
         GROUP BY a.id, u.avatar_url
         ORDER BY a.updated_at DESC
         LIMIT $1`,
        [limit],
      );
      return fallback.rows;
    }

    return result.rows.map(({ relevance: _r, ...row }) => row);
  }
}
