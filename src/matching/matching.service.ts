import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

export interface AdvocateMatch {
  advocateId: string;
  id: string;
  name: string;
  enrolmentNumber: string;
  practiceAreas: string[];
  languages: string[];
  districts: string[];
  verificationStatus: string;
}

@Injectable()
export class MatchingService {
  constructor(private db: DatabaseService) {}

  // Finds verified advocates whose practice areas overlap with the matter type.
  // Uses GIN index array-overlap (&&) for fast lookup.
  async matchAdvocates(
    matterType: string,
    district: string | null,
    language: string,
    limit = 5,
  ): Promise<AdvocateMatch[]> {
    // Build a flexible query: practice_areas match is required;
    // district + language matches boost results via ordering but are not hard filters
    // so citizens in areas with few advocates still see results.
    const result = await this.db.query(
      `SELECT
         a.id            AS "advocateId",
         a.id            AS "id",
         a.name,
         a.bar_enrolment_number AS "enrolmentNumber",
         a.practice_areas       AS "practiceAreas",
         a.languages,
         a.districts,
         a.verification_status  AS "verificationStatus",
         -- relevance score: +1 for district match, +1 for language match
         (CASE WHEN a.districts  && ARRAY[$2]::text[] THEN 1 ELSE 0 END +
          CASE WHEN a.languages  && ARRAY[$3]::text[] THEN 1 ELSE 0 END) AS relevance
       FROM advocates a
       WHERE a.verification_status = 'verified'
         AND a.practice_areas && ARRAY[$1]::text[]
       ORDER BY relevance DESC, a.updated_at DESC
       LIMIT $4`,
      [matterType, district ?? '', language, limit],
    );

    // If nothing matches on practice_areas, fall back to all verified advocates
    if (!result.rows.length) {
      const fallback = await this.db.query(
        `SELECT
           id            AS "advocateId",
           id            AS "id",
           name,
           bar_enrolment_number AS "enrolmentNumber",
           practice_areas       AS "practiceAreas",
           languages,
           districts,
           verification_status  AS "verificationStatus"
         FROM advocates
         WHERE verification_status = 'verified'
         ORDER BY updated_at DESC
         LIMIT $1`,
        [limit],
      );
      return fallback.rows;
    }

    // Strip the internal relevance column before returning
    return result.rows.map(({ relevance: _r, ...row }) => row);
  }
}
