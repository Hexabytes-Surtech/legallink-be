-- 022 — AI conversation engine (multi-turn triage chat before a matter exists)
-- Run AFTER 021_Schema.sql
--
-- The legal AI moves from a one-shot intake (one query -> one brief) to a multi-turn
-- conversational assistant: it triages whether the citizen even has a legal problem,
-- gathers the scene with follow-up questions, then — only when it IS legal AND it has
-- enough — materialises a `matter` + advocate-facing brief.
--
-- Because the matter is created LATE, the chat must live on its own first:
--   ai_conversation         — one chat
--   ai_conversation_message — each turn (user / assistant)
--
-- Anonymous ownership + 24h expiry mirror the matter table exactly:
--   session_id  — anonymous browser (matches the legallink_session cookie)
--   citizen_id  — set on OTP signup (claim), which also clears expires_at
--   expires_at  — now()+24h while anonymous; NULL once claimed (never deletes)
--   matter_id   — NULL until the conversation is promoted to a real matter

CREATE TABLE IF NOT EXISTS ai_conversation (
  conversation_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id       uuid,                                  -- users.id, NULL until claimed
  session_id       uuid,                                  -- anonymous owner (cookie)
  matter_id        uuid,                                  -- set when promoted to a matter
  language         text        NOT NULL DEFAULT 'en',     -- the citizen's chat language
  phase            text        NOT NULL DEFAULT 'triage', -- triage | gathering | ready | closed
  is_legal         boolean,                               -- NULL until triage decides
  ready_to_connect boolean     NOT NULL DEFAULT false,    -- AI has offered the advocate step
  question_count   integer     NOT NULL DEFAULT 0,        -- follow-ups asked (soft cap ~4-6)
  expires_at       timestamptz,                           -- now()+24h anon; NULL when claimed
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_conversation_language_check CHECK (language IN ('en','bn')),
  CONSTRAINT ai_conversation_phase_check    CHECK (phase IN ('triage','gathering','ready','closed'))
);

CREATE TABLE IF NOT EXISTS ai_conversation_message (
  message_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL,
  role            text        NOT NULL,                   -- user | assistant
  content         text        NOT NULL,                   -- the text shown / said
  meta            jsonb,                                  -- assistant turn extras: phase, followUp, steps, classification
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ai_conversation_message_role_check CHECK (role IN ('user','assistant'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_conv_session  ON ai_conversation (session_id) WHERE citizen_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ai_conv_citizen  ON ai_conversation (citizen_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_expires  ON ai_conversation (expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_conv_matter   ON ai_conversation (matter_id);
CREATE INDEX IF NOT EXISTS idx_ai_conv_msg_conv ON ai_conversation_message (conversation_id, created_at);

-- Foreign keys (idempotent — only add if missing).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_matter_fk') THEN
    ALTER TABLE ai_conversation ADD CONSTRAINT ai_conversation_matter_fk
      FOREIGN KEY (matter_id) REFERENCES matter (matter_id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_citizen_fk') THEN
    ALTER TABLE ai_conversation ADD CONSTRAINT ai_conversation_citizen_fk
      FOREIGN KEY (citizen_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_conversation_message_conv_fk') THEN
    ALTER TABLE ai_conversation_message ADD CONSTRAINT ai_conversation_message_conv_fk
      FOREIGN KEY (conversation_id) REFERENCES ai_conversation (conversation_id) ON DELETE CASCADE;
  END IF;
END $$;
