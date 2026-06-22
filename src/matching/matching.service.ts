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

// ── Scoring weights (sum = 100) ───────────────────────────────────────────────
//
// Location  40 pts — advocate practices in the SAME DISTRICT as the matter.
//   Client-advocate proximity is the single biggest predictor of a useful match:
//   local advocates know the district court staff, local procedure, and local law.
//   A non-zero fallback (10 pts) is given when district is unknown so the column
//   doesn't collapse to zero for all rows and wipe out ordering entirely.
//
// Case wins 35 pts — advocate has WON past cases of the same matter type
//   (self-reported via advocate_case_history). Each win is worth 17 pts, capped at
//   35 (i.e. 2+ wins max out the column). Wins outweigh a single win by design.
//
// Court exp 15 pts — advocate has ANY case history (won/settled/ongoing) in the
//   matter's district. This captures local court familiarity even when the specific
//   court name doesn't match the matter's classification court string.
//
// Language  10 pts — language match between matter intake_language and advocate's
//   supported languages array.

const SCORE_SQL = `
  (
    CASE WHEN $2 != '' AND $2 = ANY(a.districts) THEN 40
         WHEN $2 != ''                            THEN 10
         ELSE 0 END
  + LEAST(35, COALESCE(wc.win_count, 0)::int * 17)
  + CASE WHEN de.advocate_id IS NOT NULL THEN 15 ELSE 0 END
  + CASE WHEN $3 != '' AND $3 = ANY(a.languages)  THEN 10 ELSE 0 END
  )`.trim();

@Injectable()
export class MatchingService {
  constructor(private db: DatabaseService) {}

  // Finds verified advocates whose practice areas overlap with the matter type,
  // then ranks by a 100-point composite: location (40) + case wins (35) +
  // court experience (15) + language (10).
  //
  // candidateTerms — practice area labels including raw AI type and canonical label
  // district       — matter's jurisdiction district (may be null)
  // language       — matter's intake_language
  // matterType     — canonical practice area label e.g. 'Labour' (for win lookup)
  async matchAdvocates(
    candidateTerms: string[],
    district: string | null,
    language: string,
    matterType: string,
    limit = 5,
    offset = 0,
  ): Promise<{ rows: AdvocateMatch[]; total: number }> {
    const districtVal = district ?? '';
    const langVal = language ?? '';

    // Count practice-area matches first so pagination reports the true total.
    const countRes = await this.db.query(
      `SELECT COUNT(*)::int AS total
       FROM advocates a
       WHERE a.verification_status = 'verified'
         AND a.practice_areas && $1::text[]`,
      [candidateTerms],
    );
    const practiceTotal: number = countRes.rows[0].total;

    if (practiceTotal > 0) {
      const result = await this.db.query(
        `WITH win_counts AS (
           SELECT advocate_id, COUNT(*)::int AS win_count
           FROM advocate_case_history
           WHERE matter_type = $4 AND outcome = 'won'
           GROUP BY advocate_id
         ),
         district_exp AS (
           SELECT DISTINCT advocate_id
           FROM advocate_case_history
           WHERE district = $2 AND $2 != ''
         )
         SELECT ${CARD_COLUMNS},
                ${SCORE_SQL} AS score
         ${CARD_JOINS}
         LEFT JOIN win_counts wc   ON wc.advocate_id = a.id
         LEFT JOIN district_exp de ON de.advocate_id = a.id
         WHERE a.verification_status = 'verified'
           AND a.practice_areas && $1::text[]
         GROUP BY a.id, u.avatar_url, wc.win_count, de.advocate_id
         ORDER BY score DESC, a.updated_at DESC
         LIMIT $5 OFFSET $6`,
        [candidateTerms, districtVal, langVal, matterType, limit, offset],
      );
      return {
        rows: result.rows.map(({ score: _s, ...row }) => row),
        total: practiceTotal,
      };
    }

    // Fallback: no practice-area match → return all verified advocates ranked by
    // location + language only (no wins filter since matter type doesn't match).
    const countAll = await this.db.query(
      `SELECT COUNT(*)::int AS total FROM advocates a WHERE a.verification_status = 'verified'`,
    );
    const fallback = await this.db.query(
      `WITH district_exp AS (
         SELECT DISTINCT advocate_id
         FROM advocate_case_history
         WHERE district = $2 AND $2 != ''
       )
       SELECT ${CARD_COLUMNS},
              (CASE WHEN $2 != '' AND $2 = ANY(a.districts) THEN 40
                    WHEN $2 != ''                            THEN 10
                    ELSE 0 END
             + CASE WHEN de.advocate_id IS NOT NULL THEN 15 ELSE 0 END
             + CASE WHEN $3 != '' AND $3 = ANY(a.languages) THEN 10 ELSE 0 END
              ) AS score
       ${CARD_JOINS}
       LEFT JOIN district_exp de ON de.advocate_id = a.id
       WHERE a.verification_status = 'verified'
       GROUP BY a.id, u.avatar_url, de.advocate_id
       ORDER BY score DESC, a.updated_at DESC
       LIMIT $4 OFFSET $5`,
      [districtVal, districtVal, langVal, limit, offset],
    );
    return {
      rows: fallback.rows.map(({ score: _s, ...row }) => row),
      total: countAll.rows[0].total,
    };
  }
}
