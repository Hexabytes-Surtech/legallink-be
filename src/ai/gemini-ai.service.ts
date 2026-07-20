import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { DatabaseService } from '../database/database.service';
import { AiClassification } from './ai.service';

interface GeminiBriefPayload {
  matterType: string;
  primaryDomain: string;
  urgencyLevel: 'low' | 'medium' | 'high';
  involvesPolice: boolean;
  safetyConcern: boolean;
  location: { state: string; district: string | null } | null;
  incidentDate: string | null;
  applicableLaws: { act: string; sections: string[]; confidence: 'high' | 'medium' | 'low' }[];
  issues: string[];
  responseEnglish: string;
  responseBengali: string;
  proceduralStepsEnglish: string[];
  proceduralStepsBengali: string[];
  nextStepsEnglish: string[];
  nextStepsBengali: string[];
  citationHints: { actId: string; sections: string[] }[];
}

const DISCLAIMER_EN =
  'This is legal information only, not legal advice. Please consult a qualified advocate for your specific situation.';
const DISCLAIMER_BN =
  'এটি কেবল আইনি তথ্য, আইনি পরামর্শ নয়। আপনার নির্দিষ্ট পরিস্থিতির জন্য একজন যোগ্য আইনজীবীর সঙ্গে পরামর্শ করুন।';

const SYSTEM_INSTRUCTION = `You are LegalLink's senior legal advisor for citizens of India, with deep expertise in West Bengal jurisdiction. You speak to ordinary people who are often scared, confused, and may have never consulted a lawyer before. Your role is to:

1. Listen carefully to the citizen's problem.
2. Explain in plain language what Indian law says about it, citing REAL statutes (act names and section numbers).
3. Suggest concrete, doable next actions the person can realistically take themselves.
4. Reassure them without making promises or guarantees.
5. End your en (English) main response with the EXACT line: "Would you like to connect with one of our verified advocates who can help you take this forward?"
6. End your bn (Bengali) main response with the EXACT line: "আপনি কি আমাদের একজন যাচাইকৃত আইনজীবীর সঙ্গে সংযুক্ত হতে চান যিনি এই বিষয়ে আপনাকে এগিয়ে যেতে সাহায্য করতে পারেন?"

ABSOLUTELY NEVER:
- Promise outcomes ("you will win", "you will get a refund", "you will be acquitted").
- Push the citizen toward any action they did not ask about; offer options, never directives.
- Mention fees, retainer amounts, or money any advocate might charge (BCI Rule 36 violation).
- Recommend specific advocates by name.
- Use intimidating legal jargon without immediately explaining it in everyday words.
- Diagnose facts you have not been told. If a detail is missing, say "if X is true, then Y" instead of assuming.

ALWAYS:
- Speak like a kind senior advocate over a cup of tea — warm, patient, clear, never lecturing.
- Cite real Indian statutes. Useful anchors include: Bharatiya Nyaya Sanhita 2023 (BNS, replacing IPC), Bharatiya Nagarik Suraksha Sanhita 2023 (replacing CrPC), Motor Vehicles Act 1988, Consumer Protection Act 2019, West Bengal Premises Tenancy Act 1997, Protection of Women from Domestic Violence Act 2005, Negotiable Instruments Act 1881, Indian Contract Act 1872, Payment of Wages Act 1936, Industrial Disputes Act 1947, Hindu Marriage Act 1955, Special Marriage Act 1954.
- Note when the situation is urgent (police involvement, safety risk, statutory deadline approaching).
- Acknowledge that you are giving legal information, not legal advice.
- Respond in BOTH English and Bengali, regardless of the citizen's input language — the platform shows both.
- For citationHints, you MUST pick actId values ONLY from this exact list of acts that the platform's legal corpus has indexed. Picking anything else means the citation cannot be resolved and the citizen sees no statute chip.
   - "bns"                                                      (Bharatiya Nyaya Sanhita 2023, the new criminal code replacing IPC — use for criminal matters, assault, theft, threats, fraud)
   - "bharatiya_nagarik_suraksha_sanhita"                       (the new criminal procedure code replacing CrPC — use for FIR, arrest, bail, criminal procedure)
   - "motor_vehicles_act"                                       (Motor Vehicles Act 1988 — traffic, accidents, licensing, insurance)
   - "negotiable_instruments_act"                               (cheque bounce — section 138 etc.)
   - "consumer_protection_act"                                  (Consumer Protection Act 2019 — defective goods, deficient services, refund)
   - "protection_of_women_from_domestic_violence_act"           (PWDVA 2005 — domestic violence, protection orders, monetary relief)
   - "the_west_bengal_land_reforms_act_1955"                    (West Bengal land reforms — bargadar/sharecropper, agricultural land)
   - "the_west_bengal_land_reforms_and_tenancy_tribunal_act_1997" (tenancy disputes in West Bengal — landlord-tenant matters, eviction)
   For tenancy/eviction questions in West Bengal, USE the_west_bengal_land_reforms_and_tenancy_tribunal_act_1997. Do not invent actIds like "the_west_bengal_premises_tenancy_act_1997" — that is not in our corpus and the citation will be dropped. Use sections in plain numeric form like "12" or "Section 12".

OUTPUT FORMAT:
Return STRICTLY a JSON object matching the schema. No prose outside the JSON. No markdown fences. No explanations. Just the JSON.`;

// Models tried in order if the primary configured model returns retryable errors
// across all retries. The primary model goes first. Gemini 3 escape hatches added
// (verified against generateContent); gemini-2.0-flash removed — being shut down (404).
const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];

@Injectable()
export class GeminiAiService {
  private readonly logger = new Logger(GeminiAiService.name);
  private readonly client: GoogleGenAI | null;
  private readonly primaryModel: string;
  private readonly modelChain: string[];
  private readonly apiKey: string | undefined;

  constructor(
    private db: DatabaseService,
    private config: ConfigService,
  ) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim() || undefined;
    this.primaryModel = this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
    this.client = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;

    // Build a fallback chain: primary first, then any FALLBACK_MODELS not already in it.
    const chain = [this.primaryModel];
    for (const m of FALLBACK_MODELS) if (!chain.includes(m)) chain.push(m);
    this.modelChain = chain;

    if (this.client) {
      this.logger.log(`Gemini AI service active (primary=${this.primaryModel}, fallbacks=[${this.modelChain.slice(1).join(', ')}])`);
    } else {
      this.logger.log('Gemini AI service inactive — GEMINI_API_KEY not set');
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async processMatter(matterId: string, queryText: string, language: string): Promise<void> {
    if (!this.client) {
      throw new Error('Gemini client not initialised (GEMINI_API_KEY missing)');
    }

    const payload = await this.callGemini(queryText, language);
    const grounded = await this.groundCitations(payload.citationHints);

    const classification: AiClassification = {
      matterType: payload.matterType,
      primaryDomain: payload.primaryDomain,
      statute: this.summariseStatute(payload.applicableLaws),
      userQuestion: queryText.length > 120 ? queryText.slice(0, 120) + '…' : queryText,
      urgencyLevel: payload.urgencyLevel,
      involvesPolice: payload.involvesPolice,
      safetyConcern: payload.safetyConcern,
      confidence: payload.applicableLaws[0]?.confidence ?? 'medium',
      applicableLaws: payload.applicableLaws,
      issues: payload.issues,
      remediationRoutes: [
        {
          name: 'Consult a verified advocate',
          complexity: 'simple',
          canSelfStart: false,
          proceduralType: 'Legal Consultation',
        },
      ],
      location: payload.location ?? { state: 'West Bengal', district: null },
      incidentDate: payload.incidentDate || null,
    };

    await this.db.query(
      `UPDATE matter
       SET classification_json = $1,
           category_primary    = $2,
           confidence_score    = $3,
           status              = 'verified',
           updated_at          = NOW()
       WHERE matter_id = $4`,
      [
        JSON.stringify(classification),
        payload.matterType,
        payload.applicableLaws[0]?.confidence === 'high'
          ? 0.9
          : payload.applicableLaws[0]?.confidence === 'low'
            ? 0.55
            : 0.75,
        matterId,
      ],
    );

    const briefJson: Record<string, unknown> = {
      notice: language === 'bn' ? DISCLAIMER_BN : DISCLAIMER_EN,
      en_main_analysis: payload.responseEnglish,
      en_procedural_steps: payload.proceduralStepsEnglish,
      en_next_steps: payload.nextStepsEnglish,
      bn_summary: payload.responseBengali,
      bn_procedural: payload.proceduralStepsBengali,
      bn_next_steps: payload.nextStepsBengali,
      generated_by: 'gemini',
      gemini_model: this.primaryModel,
    };

    await this.db.query(
      `INSERT INTO matter_brief_version (matter_id, language_code, brief_json, grounded)
       VALUES ($1, $2, $3, $4)`,
      [matterId, language === 'bn' ? 'bn' : 'en', JSON.stringify(briefJson), grounded.length > 0],
    );

    // Best-effort citation persistence: matter_citation FK points at legal_document_unit
    // but the corpus we read from is legal_unit — IDs may not match. Citation info is
    // already embedded in brief_json + classification.applicableLaws, so a failure here
    // is non-fatal.
    let citationsPersisted = 0;
    for (const unit of grounded) {
      try {
        await this.db.query(
          `INSERT INTO matter_citation (matter_id, unit_id, relevance_score, retrieval_method)
           VALUES ($1, $2, $3, 'gemini-grounding')
           ON CONFLICT DO NOTHING`,
          [matterId, unit.unit_id, 0.85],
        );
        citationsPersisted++;
      } catch (err) {
        this.logger.warn(
          `Citation persistence skipped for matter=${matterId} unit=${unit.unit_id} (${(err as Error).message.slice(0, 100)})`,
        );
      }
    }

    await this.db.query(
      `UPDATE matter SET status = 'brief_generated', updated_at = NOW() WHERE matter_id = $1`,
      [matterId],
    );

    this.logger.log(
      `Gemini brief generated for matter=${matterId} (type=${payload.matterType}, grounded=${grounded.length}, urgency=${payload.urgencyLevel})`,
    );
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async callGemini(queryText: string, language: string): Promise<GeminiBriefPayload> {
    const userPrompt = `Citizen's intake language: ${language === 'bn' ? 'Bengali' : 'English'}.\nCitizen's matter:\n"""\n${queryText}\n"""`;

    let lastError: Error | undefined;

    // Walk the model chain: primary → fallbacks. Each model gets a small retry
    // budget for transient errors before we drop to the next model.
    for (let m = 0; m < this.modelChain.length; m++) {
      const model = this.modelChain[m];
      const isPrimary = m === 0;
      const maxAttempts = isPrimary ? 3 : 2;
      const backoffMs = [0, 1500, 4000];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          this.logger.warn(`Gemini retry ${attempt}/${maxAttempts - 1} on model=${model} after ${backoffMs[attempt]}ms (last: ${lastError?.message?.slice(0, 120)})`);
          await new Promise(r => setTimeout(r, backoffMs[attempt]));
        }
        try {
          const response = await this.client!.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema: GEMINI_RESPONSE_SCHEMA,
              temperature: 0.4,
              maxOutputTokens: 16384,
              thinkingConfig: { thinkingBudget: 2048 },
            },
          });

          const text = response.text;
          if (!text) throw new Error('Gemini returned an empty response');

          let parsed: GeminiBriefPayload;
          try {
            parsed = JSON.parse(text) as GeminiBriefPayload;
          } catch (err) {
            this.logger.error(
              `Gemini JSON parse failed (model=${model}): ${(err as Error).message}; raw_head="${text.slice(0, 200)}…"; raw_tail="…${text.slice(-200)}"; total_len=${text.length}`,
            );
            throw new Error('Gemini response was not valid JSON');
          }

          this.assertPayloadShape(parsed);
          if (!isPrimary) {
            this.logger.warn(`Gemini succeeded on fallback model=${model} (primary=${this.primaryModel} was unavailable)`);
          }
          return parsed;
        } catch (err) {
          lastError = err as Error;
          if (!this.isRetryable(lastError) || attempt === maxAttempts - 1) {
            // Non-retryable inside this model OR last attempt for this model → bail out of inner loop.
            break;
          }
        }
      }

      if (lastError && !this.isRetryable(lastError)) {
        // Non-retryable (bad request, schema mismatch, JSON parse, etc.) — no point trying other models.
        throw lastError;
      }
      // Else: retryable error exhausted on this model — slide to next fallback.
      if (m < this.modelChain.length - 1) {
        this.logger.warn(`Gemini model=${model} exhausted retries; falling back to model=${this.modelChain[m + 1]}`);
      }
    }
    throw lastError ?? new Error('Gemini call failed across all models');
  }

  private isRetryable(err: Error): boolean {
    const msg = (err.message || '').toLowerCase();
    return (
      msg.includes('unavailable') ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.includes('502') ||
      msg.includes('overload') ||
      msg.includes('rate limit') ||
      msg.includes('high demand') ||
      msg.includes('temporary')
    );
  }

  private assertPayloadShape(p: GeminiBriefPayload): void {
    const required: (keyof GeminiBriefPayload)[] = [
      'matterType',
      'primaryDomain',
      'urgencyLevel',
      'responseEnglish',
      'responseBengali',
      'applicableLaws',
      'citationHints',
    ];
    for (const k of required) {
      if (p[k] === undefined || p[k] === null) {
        throw new Error(`Gemini payload missing required field: ${k}`);
      }
    }
    if (!Array.isArray(p.applicableLaws)) throw new Error('applicableLaws must be array');
    if (!Array.isArray(p.citationHints)) throw new Error('citationHints must be array');
  }

  private async groundCitations(
    hints: { actId: string; sections: string[] }[],
  ): Promise<{ unit_id: string; act_name: string; section_number: string }[]> {
    if (!hints.length) return [];

    // Query against `legal_document_unit` — the table that `matter_citation.unit_id`
    // FKs into. Column mapping: source_id ≈ act_id, node_label = "Section N",
    // doc_title = human act name, citation_text = "Act, Section N".
    const results: { unit_id: string; act_name: string; section_number: string }[] = [];
    const want = new Set<string>(); // dedupe unit_ids

    for (const hint of hints) {
      if (!hint.actId || !hint.sections?.length) continue;

      // Build the list of node_label patterns from the section numbers Gemini gave us.
      // Section can be "18", "Section 18", "18(1)", etc. — accept the plain digit form
      // by prefixing "Section " and also try a LIKE match for partial.
      const labels = hint.sections.flatMap(s => {
        const clean = String(s).trim().replace(/^(?:section|sec\.?|§)\s*/i, '');
        return [`Section ${clean}`, `Section ${clean}.`, clean];
      });

      try {
        const r = await this.db.query(
          `SELECT unit_id,
                  doc_title    AS act_name,
                  node_label   AS section_number
             FROM legal_document_unit
             WHERE source_id LIKE $1
               AND (node_label = ANY($2::text[]) OR node_label ILIKE $3)
             LIMIT 4`,
          [
            // match either exact source_id or chunked variants (e.g. "bns" matches "bns__chunk1")
            `${hint.actId.toLowerCase()}%`,
            labels,
            // last-ditch ILIKE: any node_label that contains the first section number raw
            `%${String(hint.sections[0]).replace(/[^\d]/g, '')}%`,
          ],
        );
        for (const row of r.rows) {
          if (!want.has(row.unit_id)) {
            want.add(row.unit_id);
            results.push(row);
          }
        }
      } catch (err) {
        this.logger.warn(`Citation grounding lookup failed for actId=${hint.actId}: ${(err as Error).message}`);
      }
      if (results.length >= 8) break;
    }
    return results;
  }

  private summariseStatute(laws: GeminiBriefPayload['applicableLaws']): string | null {
    if (!laws.length) return null;
    const top = laws[0];
    return `${top.act} §${top.sections.join(', §')}`;
  }
}

// ── JSON Schema (Gemini structured output) ───────────────────────────────────
// Kept at module scope so the SDK doesn't re-allocate it on each call.
const GEMINI_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    matterType: {
      type: Type.STRING,
      description:
        'snake_case key like tenancy_dispute, criminal_matter, consumer_complaint, cheque_bounce, motor_vehicle_offence, domestic_violence, labour_employment, family_matter, civil_general',
    },
    primaryDomain: {
      type: Type.STRING,
      description: 'Human-readable domain, e.g. "Tenancy & Housing", "Criminal Law"',
    },
    urgencyLevel: {
      type: Type.STRING,
      enum: ['low', 'medium', 'high'],
    },
    involvesPolice: { type: Type.BOOLEAN },
    safetyConcern: { type: Type.BOOLEAN },
    location: {
      type: Type.OBJECT,
      properties: {
        state: { type: Type.STRING },
        district: { type: Type.STRING, nullable: true },
      },
      required: ['state'],
    },
    incidentDate: {
      type: Type.STRING,
      description: 'ISO date (YYYY-MM-DD) if a specific date is mentioned, else empty string',
    },
    applicableLaws: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          act: { type: Type.STRING, description: 'Full act name, e.g. "Motor Vehicles Act, 1988"' },
          sections: { type: Type.ARRAY, items: { type: Type.STRING } },
          confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
        },
        required: ['act', 'sections', 'confidence'],
      },
    },
    issues: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'One-line legal issues identified in the matter',
    },
    responseEnglish: {
      type: Type.STRING,
      description:
        'Warm conversational advisor response in English. 2–4 short paragraphs. MUST end with: "Would you like to connect with one of our verified advocates who can help you take this forward?"',
    },
    responseBengali: {
      type: Type.STRING,
      description:
        'Same response in Bengali. 2–4 short paragraphs. MUST end with: "আপনি কি আমাদের একজন যাচাইকৃত আইনজীবীর সঙ্গে সংযুক্ত হতে চান যিনি এই বিষয়ে আপনাকে এগিয়ে যেতে সাহায্য করতে পারেন?"',
    },
    proceduralStepsEnglish: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '3–5 concrete steps the citizen can take themselves',
    },
    proceduralStepsBengali: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    nextStepsEnglish: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '2–4 actions to take next, in order',
    },
    nextStepsBengali: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    citationHints: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          actId: {
            type: Type.STRING,
            description:
              'Lowercase snake_case act key for the platform corpus. Known: motor_vehicles_act, bns, the_west_bengal_land_reforms_act_1955, negotiable_instruments_act, consumer_protection_act, protection_of_women_from_domestic_violence_act',
          },
          sections: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['actId', 'sections'],
      },
    },
  },
  required: [
    'matterType',
    'primaryDomain',
    'urgencyLevel',
    'involvesPolice',
    'safetyConcern',
    'applicableLaws',
    'issues',
    'responseEnglish',
    'responseBengali',
    'proceduralStepsEnglish',
    'proceduralStepsBengali',
    'nextStepsEnglish',
    'nextStepsBengali',
    'citationHints',
  ],
  propertyOrdering: [
    'matterType',
    'primaryDomain',
    'urgencyLevel',
    'involvesPolice',
    'safetyConcern',
    'location',
    'incidentDate',
    'applicableLaws',
    'issues',
    'responseEnglish',
    'responseBengali',
    'proceduralStepsEnglish',
    'proceduralStepsBengali',
    'nextStepsEnglish',
    'nextStepsBengali',
    'citationHints',
  ],
} as const;
