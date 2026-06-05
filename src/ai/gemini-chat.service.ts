import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';

// ─────────────────────────────────────────────────────────────────────────────
// Multi-turn conversational TRIAGE engine for LegalLink.
//
// This is the NEW conversational brain. It lives ALONGSIDE the one-shot
// GeminiAiService (gemini-ai.service.ts) — that file is untouched and still
// powers the legacy POST /api/matter flow. This service powers the new chat:
//   citizen describes a problem → AI triages "is this even legal?" →
//   if not, kind reply + politely close; if yes, gather the scene with
//   follow-ups → offer a verified advocate → on connect, hand over a concise
//   ENGLISH brief (the assembled scene, not the transcript).
//
// Gemini is stateless, so every turn we replay the whole history + the new
// user message and get back ONE structured turn (reply + state).
// ─────────────────────────────────────────────────────────────────────────────

export type ChatPhase = 'triage' | 'gathering' | 'ready' | 'closed';
export type Confidence = 'high' | 'medium' | 'low';
export type Urgency = 'low' | 'medium' | 'high';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatTurnInput {
  language: 'en' | 'bn';
  history: ChatMessage[]; // prior turns, oldest first (excludes the new message)
  userMessage: string; // the citizen's newest message
}

export interface ChatApplicableLaw {
  act: string;
  sections: string[];
  confidence: Confidence;
}

export interface ChatClassification {
  matterType: string;
  primaryDomain: string;
  urgencyLevel: Urgency;
  involvesPolice: boolean;
  safetyConcern: boolean;
  applicableLaws: ChatApplicableLaw[];
  location: { state: string; district: string | null } | null;
  incidentDate: string | null;
}

export interface ChatBrief {
  sceneSummary: string;
  keyFacts: string[];
  citizenGoal: string;
  likelyLegalArea: string;
  tentativeStatutes: { act: string; sections: string[]; note: string }[];
  urgencyLevel: Urgency;
  safetyFlags: string[];
  suggestedAdvocateQuestions: string[];
}

export interface ChatTurnResult {
  phase: ChatPhase;
  isLegalProblem: boolean | null;
  assistantReply: string;
  followUpQuestion: string;
  suggestedSteps: string[];
  readyToConnect: boolean;
  classification: ChatClassification;
  brief: ChatBrief | null;
}

const SYSTEM_INSTRUCTION = `You are LegalLink's legal triage assistant for ordinary citizens of India, with deep familiarity with West Bengal. The people you talk to are often scared, confused, and have never spoken to a lawyer. You are NOT a lawyer and you NEVER pretend to be one — you give primary legal knowledge and a calm first sense of direction, then hand off to a real verified advocate.

You hold a MULTI-TURN conversation. Each turn you receive the whole chat so far and the citizen's newest message, and you reply with ONE short, human message plus structured state.

────────────────────────────────────────────────────────
LANGUAGE
- Reply ONLY in the citizen's own language. If they write in Bengali, reply in Bengali; if English, reply in English. NEVER show both languages in the chat. Detect from their words.
- Keep it conversational and plain. Short paragraphs. No legal jargon without a plain-words explanation right after.
- NOTE: the assistantReply, followUpQuestion and suggestedSteps are shown to the citizen and MUST be in their language. The brief is for the advocate and MUST always be in English.

────────────────────────────────────────────────────────
THE FOUR PHASES (you set "phase" every turn)

1. TRIAGE — Decide: is this a problem the LAW can actually help with?
   - Many problems are NOT legal. A rude bus conductor, a slow government office, a personal argument, "where do I buy a ticket?", general life frustration — these are not legal matters. When it is clearly non-legal:
        • set isLegalProblem = false and phase = "closed"
        • reply kindly, acknowledge their feeling, and point them somewhere useful (the right office, helpline, customer service, or simply reassurance)
        • set readyToConnect = false; do NOT create a brief, do NOT offer an advocate, do NOT push anything.
   - If it MIGHT be legal but you're not sure, ask ONE simple clarifying question first and keep phase = "triage".
   - When it IS genuinely legal, set isLegalProblem = true and move to "gathering".

2. GATHERING — You've confirmed it's legal. Now gently build the full picture.
   - Ask ONE focused follow-up question at a time, woven naturally into your reply. Never interrogate with a list.
   - Aim for roughly 4–6 questions total — enough to understand WHO, WHAT happened, WHEN, WHERE, and what the citizen WANTS. Stop sooner if the picture is already clear.
   - If at ANY point the citizen says something like "just connect me", "I don't know more", "enough questions", or asks for a lawyer — respect it immediately and move to "ready".
   - You may offer gentle, basic steps (suggestedSteps) as you go — things an ordinary person can realistically do. Frame them softly: "you could…", "it often helps to…". NEVER command, and NEVER claim any step or reading of the law is guaranteed or 100% correct.

3. READY — You understand enough, OR the citizen wants to proceed.
   - set phase = "ready", readyToConnect = true.
   - Warmly offer to connect them with a verified advocate, e.g.: "I think a verified advocate could really help you take this forward. Would you like me to connect you with one?"
   - Produce the "brief" object (the assembled scene for the advocate — see below), in ENGLISH.

4. CLOSED — Use ONLY for a clearly non-legal problem (see TRIAGE). A kind, final, non-legal reply.

────────────────────────────────────────────────────────
PERSONA & HARD RULES
- Warm, calm, patient — like a kind senior advocate talking over a cup of tea.
- Never forceful. Offer options, never directives.
- Never claim certainty. Use "it seems", "this may fall under", "an advocate can confirm".
- NEVER promise an outcome ("you will win / get a refund / be acquitted").
- NEVER mention fees, charges, or money any advocate may take (BCI Rule 36).
- NEVER name a specific advocate.
- NEVER invent facts you weren't told. If a fact is missing, ask or say "if X, then Y".

SAFETY OVERRIDE (takes priority over everything):
- If there is active danger — ongoing violence, threat to life, abuse, a child at risk, self-harm — your FIRST words must surface immediate help before anything else:
    • Police emergency: 112 (or 100)
    • Women's helpline: 1091     • Domestic violence support: 181
    • Child helpline: 1098
  Set classification.safetyConcern = true and classification.urgencyLevel = "high".

────────────────────────────────────────────────────────
STATUTES (light touch only)
You may briefly and TENTATIVELY mention which law might apply, to orient the citizen — never as a definitive ruling. When you record statutes in the brief/classification, the platform's indexed corpus only knows these act keys (use ONLY these for actId; an unknown key is dropped):
   bns                                                  (criminal — assault, theft, threats, fraud; replaces IPC)
   bharatiya_nagarik_suraksha_sanhita                   (FIR, arrest, bail, criminal procedure; replaces CrPC)
   motor_vehicles_act                                   (traffic, accidents, licensing, insurance)
   negotiable_instruments_act                           (cheque bounce — s.138)
   consumer_protection_act                              (defective goods, deficient service, refund)
   protection_of_women_from_domestic_violence_act       (domestic violence, protection orders)
   the_west_bengal_land_reforms_act_1955                (sharecropper / agricultural land)
   the_west_bengal_land_reforms_and_tenancy_tribunal_act_1997  (WB landlord–tenant, eviction)

────────────────────────────────────────────────────────
THE BRIEF (only when phase = "ready" and isLegalProblem = true) — ALWAYS IN ENGLISH
A concise, INFORMATIVE handover an advocate reads in 30 seconds — the scene you assembled, NOT the raw transcript. Four parts:
   1. sceneSummary + keyFacts  — what happened, the facts that matter
   2. citizenGoal              — what the citizen actually wants
   3. likelyLegalArea + tentativeStatutes (clearly marked tentative via the "note" field)
   4. urgencyLevel / safetyFlags + suggestedAdvocateQuestions the lawyer should ask next
Keep it tight and factual. No filler, no promises.

────────────────────────────────────────────────────────
OUTPUT
Return STRICTLY one JSON object matching the schema. No prose outside JSON, no markdown fences.
- Populate "brief" ONLY on a ready turn; otherwise set it to null.
- Fill "classification" progressively with whatever you know so far (best guess is fine; for a non-legal chat use matterType "non_legal").`;

// Models tried in order if the primary configured model returns retryable errors
// across all retries. Mirrors GeminiAiService so both brains degrade the same way.
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];

@Injectable()
export class GeminiChatService {
  private readonly logger = new Logger(GeminiChatService.name);
  private readonly client: GoogleGenAI | null;
  private readonly primaryModel: string;
  private readonly modelChain: string[];
  private readonly apiKey: string | undefined;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get<string>('GEMINI_API_KEY')?.trim() || undefined;
    this.primaryModel = this.config.get<string>('GEMINI_MODEL')?.trim() || 'gemini-flash-latest';
    this.client = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;

    const chain = [this.primaryModel];
    for (const m of FALLBACK_MODELS) if (!chain.includes(m)) chain.push(m);
    this.modelChain = chain;

    if (this.client) {
      this.logger.log(`Gemini chat engine active (primary=${this.primaryModel}, fallbacks=[${this.modelChain.slice(1).join(', ')}])`);
    } else {
      this.logger.log('Gemini chat engine inactive — GEMINI_API_KEY not set');
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  // Run one conversational turn. Returns the structured turn (reply + state).
  async processTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
    if (!this.client) {
      throw new Error('Gemini client not initialised (GEMINI_API_KEY missing)');
    }

    // Gemini's `contents` is the running transcript: user → 'user', assistant → 'model'.
    // The newest citizen message is appended as the final user turn.
    const contents = [
      ...input.history.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [{ text: input.userMessage }],
      },
    ];

    const langName = input.language === 'bn' ? 'Bengali' : 'English';

    const raw = await this.callGemini(contents, langName);
    return this.normalise(raw, input.language);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async callGemini(
    contents: { role: string; parts: { text: string }[] }[],
    langName: string,
  ): Promise<Partial<ChatTurnResult>> {
    let lastError: Error | undefined;

    for (let m = 0; m < this.modelChain.length; m++) {
      const model = this.modelChain[m];
      const isPrimary = m === 0;
      const maxAttempts = isPrimary ? 3 : 2;
      const backoffMs = [0, 1500, 4000];

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
          this.logger.warn(`Gemini chat retry ${attempt}/${maxAttempts - 1} on model=${model} after ${backoffMs[attempt]}ms (last: ${lastError?.message?.slice(0, 120)})`);
          await new Promise(r => setTimeout(r, backoffMs[attempt]));
        }
        try {
          const response = await this.client!.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: `${SYSTEM_INSTRUCTION}\n\n(The citizen is writing in ${langName}. Reply to them in ${langName}; write the brief in English.)`,
              responseMimeType: 'application/json',
              responseSchema: CHAT_TURN_SCHEMA,
              temperature: 0.5,
              maxOutputTokens: 8192,
              thinkingConfig: { thinkingBudget: 1024 },
            },
          });

          const text = response.text;
          if (!text) throw new Error('Gemini returned an empty response');

          let parsed: Partial<ChatTurnResult>;
          try {
            parsed = JSON.parse(text) as Partial<ChatTurnResult>;
          } catch (err) {
            this.logger.error(
              `Gemini chat JSON parse failed (model=${model}): ${(err as Error).message}; raw_head="${text.slice(0, 200)}…"; total_len=${text.length}`,
            );
            throw new Error('Gemini response was not valid JSON');
          }

          if (!parsed.assistantReply || typeof parsed.assistantReply !== 'string') {
            throw new Error('Gemini chat payload missing assistantReply');
          }
          if (!isPrimary) {
            this.logger.warn(`Gemini chat succeeded on fallback model=${model} (primary=${this.primaryModel} was unavailable)`);
          }
          return parsed;
        } catch (err) {
          lastError = err as Error;
          if (!this.isRetryable(lastError) || attempt === maxAttempts - 1) break;
        }
      }

      if (lastError && !this.isRetryable(lastError)) throw lastError;
      if (m < this.modelChain.length - 1) {
        this.logger.warn(`Gemini chat model=${model} exhausted retries; falling back to model=${this.modelChain[m + 1]}`);
      }
    }
    throw lastError ?? new Error('Gemini chat call failed across all models');
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

  // Coerce a (possibly partial) model payload into a fully-formed, safe result.
  // The model can omit optional fields; we never let undefined leak downstream.
  private normalise(p: Partial<ChatTurnResult>, language: 'en' | 'bn'): ChatTurnResult {
    const phase: ChatPhase = ['triage', 'gathering', 'ready', 'closed'].includes(p.phase as string)
      ? (p.phase as ChatPhase)
      : 'triage';

    const isLegalProblem =
      typeof p.isLegalProblem === 'boolean' ? p.isLegalProblem : null;

    const c = p.classification ?? ({} as Partial<ChatClassification>);
    const classification: ChatClassification = {
      matterType: c.matterType || (isLegalProblem === false ? 'non_legal' : 'general'),
      primaryDomain: c.primaryDomain || '',
      urgencyLevel: this.asUrgency(c.urgencyLevel),
      involvesPolice: Boolean(c.involvesPolice),
      safetyConcern: Boolean(c.safetyConcern),
      applicableLaws: Array.isArray(c.applicableLaws)
        ? c.applicableLaws
            .filter(l => l && typeof l.act === 'string')
            .map(l => ({
              act: l.act,
              sections: Array.isArray(l.sections) ? l.sections.map(String) : [],
              confidence: this.asConfidence(l.confidence),
            }))
        : [],
      location:
        c.location && typeof c.location.state === 'string'
          ? { state: c.location.state, district: c.location.district ?? null }
          : null,
      incidentDate: c.incidentDate ? String(c.incidentDate) : null,
    };

    // The brief is only meaningful on a legal "ready" turn; drop it otherwise.
    let brief: ChatBrief | null = null;
    if (phase === 'ready' && isLegalProblem === true && p.brief) {
      const b = p.brief;
      brief = {
        sceneSummary: b.sceneSummary || '',
        keyFacts: Array.isArray(b.keyFacts) ? b.keyFacts.map(String) : [],
        citizenGoal: b.citizenGoal || '',
        likelyLegalArea: b.likelyLegalArea || '',
        tentativeStatutes: Array.isArray(b.tentativeStatutes)
          ? b.tentativeStatutes
              .filter(s => s && typeof s.act === 'string')
              .map(s => ({
                act: s.act,
                sections: Array.isArray(s.sections) ? s.sections.map(String) : [],
                note: s.note || '',
              }))
          : [],
        urgencyLevel: this.asUrgency(b.urgencyLevel),
        safetyFlags: Array.isArray(b.safetyFlags) ? b.safetyFlags.map(String) : [],
        suggestedAdvocateQuestions: Array.isArray(b.suggestedAdvocateQuestions)
          ? b.suggestedAdvocateQuestions.map(String)
          : [],
      };
    }

    return {
      phase,
      isLegalProblem,
      assistantReply: p.assistantReply || '',
      followUpQuestion: typeof p.followUpQuestion === 'string' ? p.followUpQuestion : '',
      suggestedSteps: Array.isArray(p.suggestedSteps) ? p.suggestedSteps.map(String) : [],
      // readyToConnect is only ever true on a legal ready turn, whatever the model said.
      readyToConnect:
        phase === 'ready' && isLegalProblem === true ? Boolean(p.readyToConnect) : false,
      classification,
      brief,
    };
  }

  private asUrgency(v: unknown): Urgency {
    return v === 'high' || v === 'medium' || v === 'low' ? v : 'low';
  }

  private asConfidence(v: unknown): Confidence {
    return v === 'high' || v === 'medium' || v === 'low' ? v : 'medium';
  }
}

// ── JSON Schema (Gemini structured output) ───────────────────────────────────
// Module scope so the SDK doesn't re-allocate it on each call.
const CHAT_TURN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    phase: {
      type: Type.STRING,
      enum: ['triage', 'gathering', 'ready', 'closed'],
      description:
        'triage=still deciding if legal; gathering=legal, collecting facts; ready=enough/citizen wants advocate; closed=clearly non-legal',
    },
    isLegalProblem: {
      type: Type.BOOLEAN,
      nullable: true,
      description: 'null while undecided in triage; true once confirmed legal; false if non-legal',
    },
    assistantReply: {
      type: Type.STRING,
      description: "The message shown to the citizen, in THEIR language only. Warm, short, plain.",
    },
    followUpQuestion: {
      type: Type.STRING,
      description: 'The single focused follow-up question this turn (gathering phase), else empty string',
    },
    suggestedSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Optional gentle basic steps the citizen could take, in their language. May be empty.',
    },
    readyToConnect: {
      type: Type.BOOLEAN,
      description: 'true ONLY on a legal ready turn where you offer to connect a verified advocate',
    },
    classification: {
      type: Type.OBJECT,
      description: 'Running scene metadata, filled progressively. Best guess is fine.',
      properties: {
        matterType: {
          type: Type.STRING,
          description: 'snake_case e.g. tenancy_dispute, criminal_matter, consumer_complaint, non_legal',
        },
        primaryDomain: { type: Type.STRING },
        urgencyLevel: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
        involvesPolice: { type: Type.BOOLEAN },
        safetyConcern: { type: Type.BOOLEAN },
        applicableLaws: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              act: { type: Type.STRING },
              sections: { type: Type.ARRAY, items: { type: Type.STRING } },
              confidence: { type: Type.STRING, enum: ['high', 'medium', 'low'] },
            },
            required: ['act', 'sections', 'confidence'],
          },
        },
        location: {
          type: Type.OBJECT,
          nullable: true,
          properties: {
            state: { type: Type.STRING },
            district: { type: Type.STRING, nullable: true },
          },
          required: ['state'],
        },
        incidentDate: {
          type: Type.STRING,
          description: 'ISO date YYYY-MM-DD if a specific date was mentioned, else empty string',
        },
      },
      required: ['matterType', 'urgencyLevel', 'involvesPolice', 'safetyConcern'],
    },
    brief: {
      type: Type.OBJECT,
      nullable: true,
      description: 'ONLY on a legal ready turn. The advocate-facing handover, ALWAYS in English. Else null.',
      properties: {
        sceneSummary: { type: Type.STRING },
        keyFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
        citizenGoal: { type: Type.STRING },
        likelyLegalArea: { type: Type.STRING },
        tentativeStatutes: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              act: { type: Type.STRING },
              sections: { type: Type.ARRAY, items: { type: Type.STRING } },
              note: { type: Type.STRING, description: 'why it MIGHT apply (tentative)' },
            },
            required: ['act', 'sections', 'note'],
          },
        },
        urgencyLevel: { type: Type.STRING, enum: ['low', 'medium', 'high'] },
        safetyFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
        suggestedAdvocateQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['sceneSummary', 'keyFacts', 'citizenGoal', 'likelyLegalArea'],
    },
  },
  required: ['phase', 'assistantReply', 'readyToConnect', 'classification'],
  propertyOrdering: [
    'phase',
    'isLegalProblem',
    'assistantReply',
    'followUpQuestion',
    'suggestedSteps',
    'readyToConnect',
    'classification',
    'brief',
  ],
} as const;
