import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { GeminiAiService } from './gemini-ai.service';

export interface AiClassification {
  matterType: string;
  primaryDomain: string;
  statute: string | null;
  userQuestion: string;
  urgencyLevel: 'low' | 'medium' | 'high';
  involvesPolice: boolean;
  safetyConcern: boolean;
  applicableLaws: { act: string; sections: string[]; confidence: string }[];
  issues: string[];
  remediationRoutes: { name: string; complexity: string; canSelfStart: boolean; proceduralType: string }[];
  confidence: string;
  location: { state: string; district: string | null } | null;
  incidentDate: string | null;
}

export interface AiBriefResult {
  classification: AiClassification;
  briefJson: Record<string, any>;
  citationUnitIds: string[];
}

// Inline response returned by legallink-ai's POST /analyze.
export interface AiAnalyzeResponse {
  classification: {
    matterType?: string;
    statute?: string | null;
    userQuestion?: string;
    involvesPolice?: boolean;
    safetyConcern?: boolean;
    incidentDate?: string | null;
    location?: { state: string; district: string | null };
    applicableLaws?: { act: string; sections: string[]; confidence: string }[];
    [key: string]: any;
  };
  citations: {
    unitId?: string;
    source?: string;
    section?: string;
    text?: string;
    url?: string;
    caseName?: string;
    citation?: string;
  }[];
  brief: {
    responseEnglish?: string;
    responseBengali?: string;
    disclaimer?: string;
  };
}

// Keyword → act mapping for mock classification
const KEYWORD_MAP: { keywords: string[]; matterType: string; actId: string; sections: string[] }[] = [
  {
    keywords: ['insurance', 'challan', 'traffic', 'vehicle', 'driving', 'fine', 'motor', 'license', 'licence'],
    matterType: 'motor_vehicle/traffic_offence',
    actId: 'motor_vehicles_act',
    sections: ['130', '196', '177'],
  },
  {
    keywords: ['eviction', 'rent', 'landlord', 'tenant', 'evict', 'lease', 'premises'],
    matterType: 'tenancy_dispute',
    actId: 'the_west_bengal_land_reforms_act_1955',
    sections: ['18', '49'],
  },
  {
    keywords: ['domestic', 'violence', 'wife', 'husband', 'dowry', 'matrimonial', 'cruelty', 'abuse'],
    matterType: 'domestic_violence',
    actId: 'protection_of_women_from_domestic_violence_act',
    sections: ['3', '12', '18'],
  },
  {
    keywords: ['cheque', 'bounce', 'dishonour', 'promissory', 'negotiable'],
    matterType: 'cheque_bounce',
    actId: 'negotiable_instruments_act',
    sections: ['138', '143'],
  },
  {
    keywords: ['consumer', 'product', 'defect', 'refund', 'service', 'complaint', 'deficiency'],
    matterType: 'consumer_complaint',
    actId: 'consumer_protection_act',
    sections: ['2', '35', '38'],
  },
  {
    keywords: ['fir', 'arrest', 'bail', 'criminal', 'police', 'accused', 'charge', 'ipc', 'bns'],
    matterType: 'criminal_matter',
    actId: 'bns',
    sections: ['109', '115', '351'],
  },
];

const DISCLAIMER =
  'This is legal information only, not legal advice. Please consult a qualified advocate for your specific situation.';

// Grounding is best-effort, but transient failures (the AI layer redeploying, a
// network blip, a dropped SSE socket → undici "terminated") are common and
// recoverable. Retry a few times with small backoff before giving up and running
// the turn ungrounded. Real transient failures fail fast, so retries are quick.
const GROUND_ATTEMPTS = 3;
const GROUND_BACKOFF_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly aiServiceUrl: string | undefined;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
    private gemini: GeminiAiService,
  ) {
    this.aiServiceUrl = this.config.get<string>('AI_SERVICE_URL')?.trim() || undefined;
  }

  // Called by MatterService after creating the matter row.
  // Dispatch order: Gemini → external AI service (AI_SERVICE_URL) → mock.
  // Each fallback logs WHY it triggered (fixes silent-AI-failure bug C1).
  async processMatter(matterId: string, queryText: string, language: string): Promise<void> {
    // AI layer (legallink-rag) generates the grounded brief — PREFERRED. Gemini still
    // powers the multi-turn triage chat (gemini-chat.service); only the one-shot brief
    // path is rerouted here. Falls back to BE-Gemini, then the keyword mock.
    if (this.aiServiceUrl) {
      try {
        await this.callRealAiService(matterId, queryText, language);
        return;
      } catch (err) {
        this.logger.warn(
          `AI layer (${this.aiServiceUrl}) failed for matter=${matterId} (${(err as Error).message}); falling back to Gemini`,
        );
      }
    }

    if (this.gemini.isAvailable()) {
      try {
        await this.gemini.processMatter(matterId, queryText, language);
        return;
      } catch (err) {
        this.logger.warn(
          `Gemini failed for matter=${matterId} (${(err as Error).message}); falling back to mock`,
        );
      }
    }

    try {
      await this.runMock(matterId, queryText, language);
      this.logger.log(`Mock AI brief generated for matter=${matterId}`);
    } catch (err) {
      // Last resort failed — re-throw so callers see something, instead of swallowing.
      this.logger.error(
        `All AI pipelines failed for matter=${matterId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw err;
    }
  }

  // Lightweight grounding for the triage CHAT: ask the AI layer (legallink-rag)
  // to retrieve real statute citations for the citizen's running narrative, so the
  // conversation cites real law verbatim instead of Gemini's memory. Returns null
  // (chat runs ungrounded) if no AI service is configured or it is unreachable.
  async ground(
    text: string,
    language: string,
    applicableLaws?: { act: string; sections: string[] }[],
  ): Promise<{ matterType: string | null; applicableLaws: any[]; citations: any[] } | null> {
    if (!this.aiServiceUrl) return null;
    for (let attempt = 1; attempt <= GROUND_ATTEMPTS; attempt++) {
      try {
        const resp = await fetch(`${this.aiServiceUrl}/ground`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            language: language === 'bn' ? 'bn' : 'en',
            applicable_laws: applicableLaws && applicableLaws.length ? applicableLaws : null,
          }),
          signal: AbortSignal.timeout(9000),
        });
        if (!resp.ok) {
          // 5xx is transient (AI layer redeploying/overloaded) — retry; 4xx is not.
          if (resp.status >= 500 && attempt < GROUND_ATTEMPTS) {
            this.logger.warn(`AI grounding ${resp.status} (attempt ${attempt}/${GROUND_ATTEMPTS}), retrying`);
            await sleep(GROUND_BACKOFF_MS * attempt);
            continue;
          }
          this.logger.warn(`AI grounding responded ${resp.status}; chat runs ungrounded`);
          return null;
        }
        const d = (await resp.json()) as {
          matter_type?: string | null;
          applicable_laws?: any[];
          citations?: any[];
        };
        return {
          matterType: d.matter_type ?? null,
          applicableLaws: Array.isArray(d.applicable_laws) ? d.applicable_laws : [],
          citations: Array.isArray(d.citations) ? d.citations : [],
        };
      } catch (err) {
        const msg = (err as Error).message.slice(0, 80);
        if (attempt < GROUND_ATTEMPTS) {
          this.logger.warn(`AI grounding failed (${msg}); retry ${attempt}/${GROUND_ATTEMPTS}`);
          await sleep(GROUND_BACKOFF_MS * attempt);
          continue;
        }
        this.logger.warn(`AI grounding failed (${msg}); chat runs ungrounded`);
        return null;
      }
    }
    return null;
  }

  // Streaming grounding: consume the AI layer's /ground/stream SSE and yield each
  // parsed event ({event, data}) so the chat can forward the agent's steps + sources
  // to the citizen live (Perplexity-style). Yields nothing if the AI layer is down.
  async *groundStream(
    text: string,
    language: string,
  ): AsyncGenerator<{ event: string; data: any }> {
    if (!this.aiServiceUrl) return;
    const seenSources = new Set<string>();
    let sawDone = false;

    for (let attempt = 1; attempt <= GROUND_ATTEMPTS && !sawDone; attempt++) {
      let resp: globalThis.Response;
      try {
        resp = await fetch(`${this.aiServiceUrl}/ground/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, language: language === 'bn' ? 'bn' : 'en' }),
          signal: AbortSignal.timeout(25000),
        });
      } catch (err) {
        this.logger.warn(`AI grounding stream connect failed (attempt ${attempt}/${GROUND_ATTEMPTS}): ${(err as Error).message.slice(0, 80)}`);
        if (attempt < GROUND_ATTEMPTS) await sleep(GROUND_BACKOFF_MS * attempt);
        continue;
      }
      if (!resp.ok || !resp.body) {
        this.logger.warn(`AI grounding stream responded ${resp.status} (attempt ${attempt}/${GROUND_ATTEMPTS})`);
        if (attempt < GROUND_ATTEMPTS) await sleep(GROUND_BACKOFF_MS * attempt);
        continue;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of block.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (!data) continue;
            let parsed: any;
            try {
              parsed = JSON.parse(data);
            } catch {
              continue; // ignore malformed event
            }
            // On a retry the FE already appended the agent-trail steps — suppress them
            // to avoid a doubled trail. Sources are de-duped (here + on the FE), so
            // re-sending is safe; `done` carries the final state.
            if (event === 'step' && attempt > 1) continue;
            if (event === 'source') {
              const id = String(parsed?.unit_id ?? parsed?.url ?? '');
              if (id && seenSources.has(id)) continue;
              if (id) seenSources.add(id);
            }
            if (event === 'done') sawDone = true;
            yield { event, data: parsed };
          }
        }
      } catch (err) {
        // Socket dropped mid-stream (AI layer redeploying, network blip): undici throws
        // "terminated". Retry if attempts remain; otherwise the turn continues ungrounded.
        this.logger.warn(`AI grounding stream interrupted (attempt ${attempt}/${GROUND_ATTEMPTS}): ${(err as Error).message.slice(0, 80)}`);
      }

      if (!sawDone && attempt < GROUND_ATTEMPTS) await sleep(GROUND_BACKOFF_MS * attempt);
    }
  }

  // ── Mock implementation ───────────────────────────────────────────────────

  private async runMock(matterId: string, queryText: string, language: string): Promise<void> {
    const lower = queryText.toLowerCase();

    // Find best keyword match
    let match = KEYWORD_MAP.find((m) => m.keywords.some((k) => lower.includes(k)));
    if (!match) match = KEYWORD_MAP[4]; // default: consumer_complaint

    // Fetch real legal_unit rows for citations
    const unitResult = await this.db.query(
      `SELECT unit_id, act_name, section_number, section_title, text_content, citation
       FROM legal_unit
       WHERE act_id = $1 AND section_number = ANY($2::text[])
       LIMIT 3`,
      [match.actId, match.sections],
    );
    const units = unitResult.rows;

    // Build classification JSON (matches Schema B structure)
    const classification: AiClassification = {
      matterType: match.matterType,
      primaryDomain: units[0]?.act_name ?? match.actId,
      statute: units.length
        ? `${units[0].act_name} §${match.sections.join(', §')}`
        : null,
      userQuestion: queryText.length > 120 ? queryText.slice(0, 120) + '…' : queryText,
      urgencyLevel: 'medium',
      involvesPolice: match.matterType === 'criminal_matter' || lower.includes('police'),
      safetyConcern: match.matterType === 'domestic_violence',
      confidence: 'high',
      applicableLaws: units.map((u) => ({
        act: u.act_name,
        sections: [u.section_number],
        confidence: 'probable',
      })),
      issues: [`Legal question about ${match.matterType.replace(/_/g, ' ')}`],
      remediationRoutes: [
        { name: 'Consult a verified advocate', complexity: 'simple', canSelfStart: false, proceduralType: 'Legal Consultation' },
        { name: 'File a formal complaint', complexity: 'moderate', canSelfStart: true, proceduralType: 'Administrative' },
      ],
      location: { state: 'West Bengal', district: null },
      incidentDate: null,
    };

    // Update matter row with classification
    await this.db.query(
      `UPDATE matter
       SET classification_json = $1,
           category_primary    = $2,
           confidence_score    = 0.80,
           status              = 'verified',
           updated_at          = NOW()
       WHERE matter_id = $3`,
      [JSON.stringify(classification), match.matterType, matterId],
    );

    // Build bilingual brief JSON (matches matter_brief_version.brief_json structure)
    const enAnalysis = units.length
      ? `Under ${units[0].act_name}, ${units.map((u) => `Section ${u.section_number} states: "${u.text_content?.slice(0, 200)}…"`).join(' ')}`
      : 'Based on applicable Indian law, you may have legal recourse in this matter.';

    const briefJson = {
      notice: DISCLAIMER,
      en_main_analysis: enAnalysis,
      en_procedural_steps: [
        'Gather all relevant documents and evidence.',
        'Consult a verified advocate from the list below.',
        'File the appropriate complaint or petition with the relevant authority.',
      ],
      en_next_steps: units.map((u) => `Review ${u.act_name} §${u.section_number}`),
      bn_summary: `এই বিষয়ে ${units[0]?.act_name ?? 'প্রযোজ্য আইন'} অনুযায়ী আপনার আইনি অধিকার রয়েছে।`,
      bn_procedural: [
        'সকল প্রাসঙ্গিক কাগজপত্র সংগ্রহ করুন।',
        'নিচের তালিকা থেকে একজন যাচাইকৃত আইনজীবীর সাথে পরামর্শ করুন।',
        'সংশ্লিষ্ট কর্তৃপক্ষের কাছে যথাযথ অভিযোগ বা আবেদন দাখিল করুন।',
      ],
      bn_next_steps: units.map((u) => `${u.act_name} ধারা ${u.section_number} পড়ুন`),
    };

    // Insert matter_brief_version row
    await this.db.query(
      `INSERT INTO matter_brief_version (matter_id, language_code, brief_json, grounded)
       VALUES ($1, $2, $3, $4)`,
      [matterId, language === 'bn' ? 'bn' : 'en', JSON.stringify(briefJson), units.length > 0],
    );

    // M-3 fix: citation chips must reference legal_document_unit — the FK target of
    // matter_citation AND the table GET /matter/:id reads from. The mock previously
    // inserted legal_unit ids, which silently failed the FK → empty chips whenever
    // Gemini wasn't configured. Here we FTS-match the query keywords against
    // legal_document_unit so the chips populate on the mock path too. Best-effort:
    // if nothing matches, chips are simply empty (no worse than before).
    const citationLookup = await this.db.query(
      `SELECT unit_id
       FROM legal_document_unit
       WHERE to_tsvector('english',
               coalesce(doc_title, '') || ' ' || coalesce(node_label, '') || ' ' ||
               coalesce(citation_text, '') || ' ' || coalesce(text_content, ''))
             @@ plainto_tsquery('english', $1)
       LIMIT 3`,
      [match.keywords.join(' ')],
    );
    let lexicalRank = 0;
    for (const row of citationLookup.rows) {
      lexicalRank += 1;
      try {
        await this.db.query(
          `INSERT INTO matter_citation (matter_id, unit_id, relevance_score, retrieval_method, lexical_rank)
           VALUES ($1, $2, $3, 'keyword', $4)
           ON CONFLICT DO NOTHING`,
          [matterId, row.unit_id, 0.80, lexicalRank],
        );
      } catch (err) {
        this.logger.warn(`Mock citation insert skipped (${(err as Error).message.slice(0, 80)})`);
      }
    }

    // Mark brief generated
    await this.db.query(
      `UPDATE matter SET status = 'brief_generated', updated_at = NOW() WHERE matter_id = $1`,
      [matterId],
    );
  }

  // Internal request/response API: the AI microservice (legallink-ai) is pure
  // compute — it classifies/retrieves/generates and RETURNS the result inline.
  // The BE owns the matter row and persists what comes back (same writer as the
  // mock + Gemini paths), so the AI service never touches our database.
  private async callRealAiService(matterId: string, queryText: string, language: string): Promise<void> {
    const response = await fetch(`${this.aiServiceUrl}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matter_id: matterId, query: queryText, language }),
    });
    if (!response.ok) throw new Error(`AI service responded ${response.status}`);

    const result = (await response.json()) as AiAnalyzeResponse;
    await this.persistAiResult(matterId, language, result);
  }

  // Writes the AI service's inline result into our schema — mirrors runMock so
  // GET /matter/:id sees an identical shape regardless of which engine ran.
  private async persistAiResult(
    matterId: string,
    language: string,
    result: AiAnalyzeResponse,
  ): Promise<void> {
    const classification = result?.classification ?? {};
    const citations = Array.isArray(result?.citations) ? result.citations : [];
    const brief = result?.brief ?? ({} as AiAnalyzeResponse['brief']);

    // 1 — classification + status on the matter row
    await this.db.query(
      `UPDATE matter
         SET classification_json = $1,
             category_primary    = $2,
             confidence_score    = $3,
             status              = 'brief_generated',
             updated_at          = NOW()
       WHERE matter_id = $4`,
      [JSON.stringify(classification), classification.matterType ?? null, 0.8, matterId],
    );

    // 2 — bilingual brief (Gemini-schema keys getMatterById reads)
    const briefJson = {
      notice: brief?.disclaimer ?? DISCLAIMER,
      en_main_analysis: brief?.responseEnglish ?? null,
      bn_summary: brief?.responseBengali ?? null,
    };
    await this.db.query(
      `INSERT INTO matter_brief_version (matter_id, language_code, brief_json, grounded)
       VALUES ($1, $2, $3, $4)`,
      [matterId, language === 'bn' ? 'bn' : 'en', JSON.stringify(briefJson), citations.length > 0],
    );

    // 3 — citation chips. unitId is a real legal_document_unit id from the AI
    // retriever, so the matter_citation FK is satisfied.
    let lexicalRank = 0;
    for (const c of citations) {
      if (!c.unitId) continue;
      lexicalRank += 1;
      try {
        await this.db.query(
          `INSERT INTO matter_citation (matter_id, unit_id, relevance_score, retrieval_method, lexical_rank)
           VALUES ($1, $2, $3, 'lexical', $4)
           ON CONFLICT DO NOTHING`,
          [matterId, c.unitId, Math.max(0.1, 1 - lexicalRank * 0.05), lexicalRank],
        );
      } catch (err) {
        this.logger.warn(`AI citation insert skipped (${(err as Error).message.slice(0, 80)})`);
      }
    }

    this.logger.log(
      `External AI brief persisted for matter=${matterId} (citations=${lexicalRank}).`,
    );
  }
}
