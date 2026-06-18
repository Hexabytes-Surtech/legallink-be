import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  GeminiChatService,
  ChatMessage,
  ChatTurnResult,
  ChatClassification,
  ChatBrief,
} from '../ai/gemini-chat.service';
import { AiService } from '../ai/ai.service';

const ANON_TTL_MS = 24 * 60 * 60 * 1000; // anonymous conversations expire after 24h
const DISCLAIMER =
  'This is legal information only, not legal advice. Please consult a qualified advocate for your specific situation.';

// What a caller is allowed to access — either an authenticated citizen or an
// anonymous browser session. Mirrors the matter ownership model exactly.
interface Caller {
  citizenId: string | null;
  sessionId: string | null;
}

interface ConversationRow {
  conversation_id: string;
  citizen_id: string | null;
  session_id: string | null;
  matter_id: string | null;
  language: 'en' | 'bn';
  phase: string;
  is_legal: boolean | null;
  ready_to_connect: boolean;
  question_count: number;
  classification_json: ChatClassification | null;
  brief_json: ChatBrief | null;
  created_at: Date;
}

@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);
  // Per-conversation grounding cache: short follow-up turns reuse the prior turn's
  // retrieved citations instead of re-hitting the AI layer (~6s saved per turn).
  private readonly groundingCache = new Map<
    string,
    { matterType: string | null; applicableLaws: any[]; citations: any[] }
  >();

  constructor(
    private db: DatabaseService,
    private gemini: GeminiChatService,
    private ai: AiService,
  ) {}

  // ── POST /api/ai/conversation ─────────────────────────────────────────────
  // Start a new chat. Anonymous (session) or authenticated (citizen). If a first
  // message is supplied, we run the opening turn immediately.
  async startConversation(dto: { language: 'en' | 'bn'; message?: string }, caller: Caller) {
    if (!['en', 'bn'].includes(dto.language)) throw new BadRequestException('LANGUAGE_UNSUPPORTED');

    // Anonymous chats expire in 24h; claimed (authenticated) chats never expire.
    const sessionForRow = caller.citizenId ? null : caller.sessionId;
    const expiresAt = caller.citizenId ? null : new Date(Date.now() + ANON_TTL_MS);

    const inserted = await this.db.query(
      `INSERT INTO ai_conversation (citizen_id, session_id, language, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING conversation_id`,
      [caller.citizenId, sessionForRow, dto.language, expiresAt],
    );
    const conversationId: string = inserted.rows[0].conversation_id;

    this.logger.log(
      `AI chat started conversation=${conversationId} (${caller.citizenId ? 'citizen' : 'anon'}, lang=${dto.language})`,
    );

    // No opening message → return the empty shell; the UI shows a static greeting.
    if (!dto.message?.trim()) {
      return this.getConversation(conversationId, caller);
    }
    // Opening message provided → run the first turn right away.
    return this.postMessage(conversationId, dto.message, caller);
  }

  // ── POST /api/ai/conversation/:id/message ─────────────────────────────────
  // One conversational turn: persist the user message, ask Gemini with full
  // history, persist + return the assistant turn, advance the conversation state.
  async postMessage(conversationId: string, message: string, caller: Caller): Promise<any> {
    const text = message?.trim();
    if (!text) throw new BadRequestException('MESSAGE_REQUIRED');
    if (text.length > 4000) throw new BadRequestException('MESSAGE_TOO_LONG');

    if (!this.gemini.isAvailable()) {
      throw new ServiceUnavailableException('AI_UNAVAILABLE');
    }

    const conv = await this.loadOwned(conversationId, caller);
    if (conv.phase === 'closed') throw new BadRequestException('CONVERSATION_CLOSED');

    // Replay the full prior transcript so the stateless model "remembers" the chat.
    const history = await this.loadHistory(conversationId);

    // Persist the citizen's message before the (slow) AI call, so nothing is lost
    // if the model errors out.
    await this.db.query(
      `INSERT INTO ai_conversation_message (conversation_id, role, content)
       VALUES ($1, 'user', $2)`,
      [conversationId, text],
    );

    // GROUND THIS TURN: retrieve real statute citations for the citizen's narrative so
    // the chat cites real law verbatim. To keep turns fast, only RE-retrieve when the
    // message adds real content; short follow-ups reuse the conversation's cached
    // grounding. Non-fatal — runs ungrounded if the AI layer is unreachable.
    const narrative = [
      ...history.filter((m) => m.role === 'user').map((m) => m.content),
      text,
    ]
      .join('\n')
      .slice(-2200);
    const cachedGrounding = this.groundingCache.get(conversationId) ?? null;
    let grounding = cachedGrounding;
    const substantive = text.trim().length >= 30;
    const worth = this.worthGrounding(narrative);
    if (worth && (!cachedGrounding || substantive)) {
      const fresh = await this.ai.ground(narrative, conv.language);
      if (fresh?.citations?.length) {
        grounding = fresh;
        this.groundingCache.set(conversationId, fresh);
        if (this.groundingCache.size > 2000) {
          this.groundingCache.delete(this.groundingCache.keys().next().value as string);
        }
        this.logger.log(
          `AI chat turn grounded: conversation=${conversationId} -> ${fresh.citations.length} citations (matter=${fresh.matterType ?? '?'})`,
        );
      } else if (cachedGrounding) {
        this.logger.log(
          `AI chat grounding empty this turn; reusing cached (${cachedGrounding.citations.length} citations)`,
        );
      }
    } else if (cachedGrounding) {
      this.logger.log(
        `AI chat reused cached grounding: conversation=${conversationId} (${cachedGrounding.citations.length} citations)`,
      );
    } else {
      this.logger.log(
        `AI chat skipped grounding (greeting/small-talk): conversation=${conversationId}`,
      );
    }

    let turn: ChatTurnResult;
    try {
      turn = await this.gemini.processTurn({
        language: conv.language,
        history,
        userMessage: text,
        grounding,
      });
    } catch (err) {
      this.logger.error(
        `AI turn failed for conversation=${conversationId}: ${(err as Error).message}`,
        (err as Error).stack,
      );
      throw new ServiceUnavailableException('AI_TURN_FAILED');
    }

    // Persist the assistant turn (with its structured extras in meta for the record).
    await this.db.query(
      `INSERT INTO ai_conversation_message (conversation_id, role, content, meta)
       VALUES ($1, 'assistant', $2, $3)`,
      [
        conversationId,
        turn.assistantReply,
        JSON.stringify({
          phase: turn.phase,
          isLegalProblem: turn.isLegalProblem,
          responseMode: turn.responseMode,
          followUpQuestion: turn.followUpQuestion,
          suggestedSteps: turn.suggestedSteps,
          emergencyContacts: turn.emergencyContacts,
          readyToConnect: turn.readyToConnect,
          citations: turn.citations,
        }),
      ],
    );

    // Advance conversation state. question_count only ticks when a real follow-up
    // was asked during gathering (so the soft cap reflects genuine questions).
    const asked = turn.phase === 'gathering' && turn.followUpQuestion.trim().length > 0;
    await this.db.query(
      `UPDATE ai_conversation
          SET phase            = $1,
              is_legal         = $2,
              ready_to_connect = $3,
              classification_json = $4,
              brief_json       = COALESCE($5, brief_json),
              question_count   = question_count + $6,
              updated_at       = now()
        WHERE conversation_id = $7`,
      [
        turn.phase,
        turn.isLegalProblem,
        turn.readyToConnect,
        JSON.stringify(turn.classification),
        turn.brief ? JSON.stringify(turn.brief) : null,
        asked ? 1 : 0,
        conversationId,
      ],
    );

    return {
      conversationId,
      phase: turn.phase,
      isLegalProblem: turn.isLegalProblem,
      responseMode: turn.responseMode,
      assistantReply: turn.assistantReply,
      followUpQuestion: turn.followUpQuestion,
      suggestedSteps: turn.suggestedSteps,
      emergencyContacts: turn.emergencyContacts,
      safetyConcern: turn.classification.safetyConcern,
      urgencyLevel: turn.classification.urgencyLevel,
      readyToConnect: turn.readyToConnect,
      // real statute citations grounding this turn — shown to the citizen as evidence.
      citations: turn.citations,
      // brief is internal (advocate-facing) — never surfaced to the citizen UI.
      matterId: conv.matter_id,
    };
  }

  // Cheap intent gate (no LLM, no network): is this narrative worth a real legal
  // search, or is it just greetings/small-talk? Strips common pleasantries (EN +
  // Bengali) and grounds only when meaningful content remains — so "hello", "hi",
  // "thanks", "ok", an emoji, etc. no longer fire the Indian Kanoon / Nyaaya /
  // India Code pipeline. Errs toward grounding ANY non-greeting (incl. short ones
  // like "police took my bike"), so a real legal query is never withheld.
  private worthGrounding(narrative: string): boolean {
    const stripped = (narrative || '')
      .toLowerCase()
      .replace(
        /\b(hi+|hello+|hey+|yo|namaste|namaskar|good (morning|afternoon|evening|day|night)|thank you|thank u|thanks|ok|okay|kk|cool|nice|great|fine|hmm+|hm+|test+|please|pls|sir|madam|maam|how are you|what'?s up|whats up|are you there|you there|help)\b/g,
        ' ',
      )
      .replace(/নমস্কার|হ্যালো|হেলো|হাই|ধন্যবাদ|কেমন আছেন/g, ' ')
      .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
      .trim();
    const words = stripped.split(/\s+/).filter((w) => w.length >= 2);
    return words.length >= 2 || words.some((w) => w.length >= 6);
  }

  // ── POST /api/ai/conversation/:id/message/stream  (Perplexity-style SSE) ──
  // Same turn as postMessage, but streamed: the citizen watches the agent analyse,
  // search Indian Kanoon, surface real sources, then the answer types out.
  async *streamMessage(
    conversationId: string,
    message: string,
    caller: Caller,
  ): AsyncGenerator<string> {
    const sse = (event: string, data: any) =>
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

    const text = message?.trim();
    if (!text) return void (yield sse('error', { message: 'MESSAGE_REQUIRED' }));
    if (text.length > 4000) return void (yield sse('error', { message: 'MESSAGE_TOO_LONG' }));
    if (!this.gemini.isAvailable()) return void (yield sse('error', { message: 'AI_UNAVAILABLE' }));

    let conv: ConversationRow;
    try {
      conv = await this.loadOwned(conversationId, caller);
    } catch {
      return void (yield sse('error', { message: 'CONVERSATION_NOT_FOUND' }));
    }
    if (conv.phase === 'closed') return void (yield sse('error', { message: 'CONVERSATION_CLOSED' }));

    const history = await this.loadHistory(conversationId);
    await this.db.query(
      `INSERT INTO ai_conversation_message (conversation_id, role, content) VALUES ($1, 'user', $2)`,
      [conversationId, text],
    );

    // 1) GROUND — stream the real agent steps + sources to the citizen.
    const narrative = [
      ...history.filter((m) => m.role === 'user').map((m) => m.content),
      text,
    ]
      .join('\n')
      .slice(-2200);
    const cached = this.groundingCache.get(conversationId) ?? null;
    const substantive = text.trim().length >= 30;
    const worth = this.worthGrounding(narrative);
    let grounding = cached;

    if (worth && (!cached || substantive)) {
      let fresh: { matterType: string | null; applicableLaws: any[]; citations: any[] } | null = null;
      for await (const ev of this.ai.groundStream(narrative, conv.language)) {
        if (ev.event === 'step') yield sse('step', ev.data);
        else if (ev.event === 'source') yield sse('source', ev.data);
        else if (ev.event === 'done')
          fresh = {
            matterType: ev.data.matter_type ?? null,
            applicableLaws: ev.data.applicable_laws ?? [],
            citations: ev.data.citations ?? [],
          };
      }
      if (fresh?.citations?.length) {
        grounding = fresh;
        this.groundingCache.set(conversationId, fresh);
        if (this.groundingCache.size > 2000)
          this.groundingCache.delete(this.groundingCache.keys().next().value as string);
        this.logger.log(`AI chat (stream) grounded: conversation=${conversationId} -> ${fresh.citations.length} citations`);
      } else if (cached) {
        grounding = cached;
      }
    } else if (cached) {
      // short follow-up: reuse cached sources instantly
      yield sse('step', { phase: 'thinking', label: 'Using what you told me' });
      for (const s of cached?.citations ?? []) yield sse('source', s);
      grounding = cached;
    }
    // else: greeting/small-talk with no prior grounding → skip the legal search
    // entirely (no "Searching Indian Kanoon" step, no sources emitted). The
    // assistant still replies conversationally below via processTurn.

    // 2) GENERATE the grounded turn, then 3) stream the answer prose.
    yield sse('step', { phase: 'writing', label: 'Preparing your answer' });
    let turn: ChatTurnResult;
    try {
      turn = await this.gemini.processTurn({ language: conv.language, history, userMessage: text, grounding });
    } catch (err) {
      this.logger.error(`AI stream turn failed conversation=${conversationId}: ${(err as Error).message}`);
      return void (yield sse('error', { message: 'AI_TURN_FAILED' }));
    }

    const words = (turn.assistantReply || '').split(' ');
    for (let i = 0; i < words.length; i += 2) {
      const chunk = words.slice(i, i + 2).join(' ') + (i + 2 < words.length ? ' ' : '');
      yield sse('token', { text: chunk });
      await new Promise((r) => setTimeout(r, 18));
    }

    // 4) Persist the assistant turn + advance state (same writes as postMessage).
    await this.db.query(
      `INSERT INTO ai_conversation_message (conversation_id, role, content, meta) VALUES ($1, 'assistant', $2, $3)`,
      [
        conversationId,
        turn.assistantReply,
        JSON.stringify({
          phase: turn.phase,
          isLegalProblem: turn.isLegalProblem,
          responseMode: turn.responseMode,
          followUpQuestion: turn.followUpQuestion,
          suggestedSteps: turn.suggestedSteps,
          emergencyContacts: turn.emergencyContacts,
          readyToConnect: turn.readyToConnect,
          citations: turn.citations,
        }),
      ],
    );
    const asked = turn.phase === 'gathering' && turn.followUpQuestion.trim().length > 0;
    await this.db.query(
      `UPDATE ai_conversation
          SET phase = $1, is_legal = $2, ready_to_connect = $3, classification_json = $4,
              brief_json = COALESCE($5, brief_json), question_count = question_count + $6, updated_at = now()
        WHERE conversation_id = $7`,
      [
        turn.phase,
        turn.isLegalProblem,
        turn.readyToConnect,
        JSON.stringify(turn.classification),
        turn.brief ? JSON.stringify(turn.brief) : null,
        asked ? 1 : 0,
        conversationId,
      ],
    );

    // 5) DONE — final structured state for the UI.
    yield sse('done', {
      conversationId,
      phase: turn.phase,
      isLegalProblem: turn.isLegalProblem,
      responseMode: turn.responseMode,
      assistantReply: turn.assistantReply,
      followUpQuestion: turn.followUpQuestion,
      suggestedSteps: turn.suggestedSteps,
      emergencyContacts: turn.emergencyContacts,
      safetyConcern: turn.classification.safetyConcern,
      urgencyLevel: turn.classification.urgencyLevel,
      readyToConnect: turn.readyToConnect,
      citations: turn.citations,
      matterId: conv.matter_id,
    });
  }

  // ── GET /api/ai/conversation/:id ──────────────────────────────────────────
  async getConversation(conversationId: string, caller: Caller) {
    const conv = await this.loadOwned(conversationId, caller);
    const msgs = await this.db.query(
      `SELECT role, content, meta, created_at
         FROM ai_conversation_message
        WHERE conversation_id = $1
        ORDER BY created_at ASC`,
      [conversationId],
    );
    return {
      conversationId: conv.conversation_id,
      language: conv.language,
      phase: conv.phase,
      isLegalProblem: conv.is_legal,
      readyToConnect: conv.ready_to_connect,
      matterId: conv.matter_id,
      messages: msgs.rows.map((m) => ({
        role: m.role,
        content: m.content,
        meta: m.meta ?? null,
        createdAt: m.created_at,
      })),
    };
  }

  // ── GET /api/ai/conversation  (history list for the signed-in citizen) ────
  // Each chat is titled by the citizen's first message (ChatGPT-style history).
  async listConversations(citizenId: string) {
    const r = await this.db.query(
      `SELECT c.conversation_id, c.phase, c.is_legal, c.matter_id, c.ready_to_connect,
              c.created_at, c.updated_at,
              (SELECT m.content FROM ai_conversation_message m
                WHERE m.conversation_id = c.conversation_id AND m.role = 'user'
                ORDER BY m.created_at ASC LIMIT 1) AS title,
              (SELECT count(*) FROM ai_conversation_message m
                WHERE m.conversation_id = c.conversation_id) AS message_count
         FROM ai_conversation c
        WHERE c.citizen_id = $1
        ORDER BY c.updated_at DESC`,
      [citizenId],
    );
    // Only surface chats that actually have a message (i.e. a derivable title).
    return r.rows
      .filter((row) => row.title)
      .map((row) => ({
        conversationId: row.conversation_id,
        title: this.makeTitle(row.title),
        phase: row.phase,
        isLegalProblem: row.is_legal,
        matterId: row.matter_id,
        readyToConnect: row.ready_to_connect,
        messageCount: Number(row.message_count) || 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
  }

  // ── DELETE /api/ai/conversation/:id ───────────────────────────────────────
  async deleteConversation(conversationId: string, caller: Caller) {
    await this.loadOwned(conversationId, caller); // 404 if not owned by the caller
    // Messages cascade; the matter FK is ON DELETE SET NULL, so any materialised
    // matter survives the chat being removed.
    await this.db.query(`DELETE FROM ai_conversation WHERE conversation_id = $1`, [conversationId]);
    return { conversationId, deleted: true };
  }

  private makeTitle(firstUserMessage: string): string {
    const t = firstUserMessage.replace(/\s+/g, ' ').trim();
    return t.length > 80 ? `${t.slice(0, 80).trimEnd()}…` : t;
  }

  // ── POST /api/ai/conversation/:id/connect ─────────────────────────────────
  // The citizen (now authenticated) chooses to connect with an advocate. We turn
  // the assembled scene into a real matter + English brief, then link them.
  async connect(conversationId: string, caller: Caller) {
    // connect REQUIRES an authenticated citizen (they must register first).
    if (!caller.citizenId) throw new ForbiddenException('REGISTRATION_REQUIRED');

    const conv = await this.loadOwned(conversationId, caller);

    if (conv.matter_id) {
      // Already connected — idempotent: just hand back the existing matter.
      return { conversationId, matterId: conv.matter_id, alreadyConnected: true };
    }
    if (conv.is_legal !== true || conv.phase !== 'ready') {
      throw new BadRequestException('NOT_READY_TO_CONNECT');
    }
    if (!conv.brief_json) throw new BadRequestException('BRIEF_NOT_READY');

    const classification = conv.classification_json ?? null;
    const brief = conv.brief_json;
    const matterId = await this.materialiseMatter(conv, classification, brief, caller.citizenId);

    // Generate the GROUNDED brief via the AI layer (legallink-rag). materialiseMatter
    // already wrote the conversational (gemini-chat) brief as an immediate fallback;
    // processMatter writes the RAG brief — real statute citations, currency-checked —
    // as the newer matter_brief_version the matter detail surfaces. Non-fatal.
    const ragQuery =
      brief.sceneSummary?.trim() || brief.citizenGoal?.trim() || 'AI-assisted intake';
    try {
      await this.ai.processMatter(matterId, ragQuery, conv.language);
    } catch (err) {
      this.logger.warn(
        `AI layer brief failed for assistant matter=${matterId} (${(err as Error).message}); kept conversational brief`,
      );
    }

    this.logger.log(
      `AI chat conversation=${conversationId} connected → matter=${matterId} (citizen=${caller.citizenId})`,
    );
    return { conversationId, matterId, alreadyConnected: false };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  // Create the matter + English brief from the gathered scene, inside one
  // transaction, and link the conversation to it. No AI re-run — the scene the
  // chat already assembled IS the brief.
  private async materialiseMatter(
    conv: ConversationRow,
    classification: ChatClassification | null,
    brief: ChatBrief,
    citizenId: string,
  ): Promise<string> {
    // intake_text is the citizen-facing "query" — use the English scene summary so
    // the matter reads sensibly regardless of the chat language.
    const intakeText = brief.sceneSummary?.trim() || brief.citizenGoal?.trim() || 'AI-assisted intake';

    // Map our running classification into the shape the advocate side reads
    // (matter.classification_json → matterType, location, urgency, etc.).
    const matterClassification = {
      matterType: classification?.matterType || 'general',
      primaryDomain: classification?.primaryDomain || brief.likelyLegalArea || '',
      urgencyLevel: classification?.urgencyLevel || brief.urgencyLevel || 'low',
      involvesPolice: classification?.involvesPolice ?? false,
      safetyConcern: classification?.safetyConcern ?? brief.safetyFlags.length > 0,
      applicableLaws: classification?.applicableLaws ?? [],
      location: classification?.location ?? { state: 'West Bengal', district: null },
      incidentDate: classification?.incidentDate ?? null,
      issues: brief.keyFacts,
      source: 'gemini-chat',
    };

    // The advocate matter-detail endpoint reads legacy brief_json keys. We populate
    // the English keys with the assembled scene, AND mirror into the bn_ keys so the
    // content shows whatever language context the advocate UI renders in. The brief
    // itself is English-only by design — both views see the same English text.
    const englishBrief = this.composeEnglishBrief(brief);
    const advocateQuestions = brief.suggestedAdvocateQuestions;
    const briefJson = {
      notice: DISCLAIMER,
      en_main_analysis: englishBrief,
      en_procedural_steps: brief.keyFacts,
      en_next_steps: advocateQuestions,
      bn_summary: englishBrief,
      bn_procedural: brief.keyFacts,
      bn_next_steps: advocateQuestions,
      // Richer structured payload for a future advocate UI that wants the raw scene.
      conversational_brief: brief,
      generated_by: 'gemini-chat',
      brief_kind: 'conversational',
    };

    const confidence = matterClassification.applicableLaws[0]?.confidence;
    const confidenceScore = confidence === 'high' ? 0.9 : confidence === 'low' ? 0.55 : 0.75;

    return this.db.withTransaction(async (q) => {
      const inserted = await q(
        `INSERT INTO matter
           (citizen_id, intake_text, intake_language, preferred_language, status,
            jurisdiction_state, classification_json, category_primary, confidence_score)
         VALUES ($1, $2, $3, $3, 'brief_generated', 'WB', $4, $5, $6)
         RETURNING matter_id`,
        [
          citizenId,
          intakeText,
          conv.language,
          JSON.stringify(matterClassification),
          matterClassification.matterType,
          confidenceScore,
        ],
      );
      const matterId: string = inserted.rows[0].matter_id;

      await q(
        `INSERT INTO matter_brief_version (matter_id, language_code, brief_json, grounded)
         VALUES ($1, $2, $3, false)`,
        [matterId, conv.language, JSON.stringify(briefJson)],
      );

      // Link the conversation to its matter and claim it for the citizen (clears any
      // anonymous expiry — once it owns a matter it must never be reaped).
      await q(
        `UPDATE ai_conversation
            SET matter_id = $1, citizen_id = $2, expires_at = NULL, phase = 'closed', updated_at = now()
          WHERE conversation_id = $3`,
        [matterId, citizenId, conv.conversation_id],
      );

      return matterId;
    });
  }

  // Build the human-readable English analysis the advocate reads at a glance.
  private composeEnglishBrief(brief: ChatBrief): string {
    const parts: string[] = [];
    if (brief.sceneSummary?.trim()) parts.push(brief.sceneSummary.trim());
    if (brief.keyFacts.length) {
      parts.push('Key facts:\n' + brief.keyFacts.map((f) => `• ${f}`).join('\n'));
    }
    if (brief.citizenGoal?.trim()) parts.push(`What the citizen wants: ${brief.citizenGoal.trim()}`);
    if (brief.likelyLegalArea?.trim()) parts.push(`Likely legal area: ${brief.likelyLegalArea.trim()}`);
    if (brief.tentativeStatutes.length) {
      const laws = brief.tentativeStatutes
        .map((s) => `• ${s.act}${s.sections.length ? ' §' + s.sections.join(', §') : ''}${s.note ? ` — ${s.note}` : ''}`)
        .join('\n');
      parts.push('Possibly relevant law (tentative — to be confirmed by the advocate):\n' + laws);
    }
    if (brief.safetyFlags.length) {
      parts.push('⚠ Safety flags: ' + brief.safetyFlags.join('; '));
    }
    return parts.join('\n\n');
  }

  private async loadHistory(conversationId: string): Promise<ChatMessage[]> {
    const r = await this.db.query(
      `SELECT role, content
         FROM ai_conversation_message
        WHERE conversation_id = $1
        ORDER BY created_at ASC`,
      [conversationId],
    );
    return r.rows.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  }

  // Load a conversation and enforce the same ownership rules as matters:
  //   authenticated citizen → citizen_id must match;
  //   anonymous            → session cookie must match.
  private async loadOwned(conversationId: string, caller: Caller): Promise<ConversationRow> {
    const r = await this.db.query(
      `SELECT conversation_id, citizen_id, session_id, matter_id, language, phase,
              is_legal, ready_to_connect, question_count, classification_json,
              brief_json, created_at
         FROM ai_conversation
        WHERE conversation_id = $1`,
      [conversationId],
    );
    if (!r.rows.length) throw new NotFoundException('CONVERSATION_NOT_FOUND');
    const conv = r.rows[0] as ConversationRow;

    if (conv.citizen_id) {
      if (!caller.citizenId || conv.citizen_id !== caller.citizenId) {
        throw new NotFoundException('CONVERSATION_NOT_FOUND');
      }
    } else {
      // Anonymous — the request must carry the owning session cookie. An authenticated
      // caller whose session matches is also fine (claim happens on connect).
      if (!caller.sessionId || conv.session_id !== caller.sessionId) {
        throw new NotFoundException('CONVERSATION_NOT_FOUND');
      }
    }
    return conv;
  }
}
