-- 026 — Case timeline + consultation closure
-- Run AFTER 025_Schema.sql
--
-- Once an advocate accepts a consultation, the matter moves through a small set of
-- professionally-recognised STAGES (Consultation Started → Advice & Review → Drafting
-- → Legal Notice / Pre-Litigation → Filed in Court → In Hearing → Closed). The advocate
-- drives the stage; the citizen views it read-only. At the end the advocate issues a
-- "Consultation Closure Summary": an outcome + a written summary, plus the two BCI duty
-- flags (client documents returned, fees settled / no dues).
--
-- Design notes:
--   • Stages live in a SEPARATE column (current_stage) + a history table — NOT in
--     consultation_request.status, which stays the 4-value pending|accepted|declined|closed.
--   • 'closed' is a terminal stage that mirrors status='closed'. It is only ever reached
--     through the close flow (which also records the closure outcome), never the stage endpoint.
--   • All enums are CHECK constraints (house convention — no Postgres enum types).
--   • consultation_timeline_event is the citizen-facing source of truth; it is keyed on the
--     consultation (a matter can have several consultations over time).

-- ── 1. Current stage + closure detail on the consultation ────────────────────────
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS current_stage        text NOT NULL DEFAULT 'consultation_started';
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_outcome      text;
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_summary      text;
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_settlement   text;   -- conditional: settled / compromise
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_new_advocate text;   -- conditional: referred / transferred
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_noc_issued   boolean;-- conditional: referred / transferred
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closure_next_steps   text;   -- conditional: dismissed / decided
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS documents_returned   boolean NOT NULL DEFAULT false;
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS fees_settled         boolean NOT NULL DEFAULT false;
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS closed_at            timestamptz;

-- CHECK constraints for the two enums (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultation_request_current_stage_check') THEN
    ALTER TABLE consultation_request ADD CONSTRAINT consultation_request_current_stage_check
      CHECK (current_stage IN (
        'consultation_started','advice_review','drafting','legal_notice',
        'filed_in_court','in_hearing','closed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultation_request_closure_outcome_check') THEN
    ALTER TABLE consultation_request ADD CONSTRAINT consultation_request_closure_outcome_check
      CHECK (closure_outcome IS NULL OR closure_outcome IN (
        'resolved','settled','withdrawn_by_client','referred',
        'advice_only','ended_early','dismissed_procedure','decided_unfavourably'));
  END IF;
END $$;

-- Backfill: any consultation already 'closed' before this migration gets a terminal
-- stage + closed_at so its timeline reads sensibly. Older closes had no recorded
-- outcome, so leave closure_outcome NULL (the UI shows a neutral "Closed" summary).
UPDATE consultation_request
   SET current_stage = 'closed',
       closed_at      = COALESCE(closed_at, updated_at, now())
 WHERE status = 'closed' AND current_stage <> 'closed';

-- ── 2. Timeline history — the dated, citizen-readable stage log ───────────────────
CREATE TABLE IF NOT EXISTS consultation_timeline_event (
  event_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid        NOT NULL,   -- consultation_request.request_id
  stage_key       text        NOT NULL,
  note            text,                   -- optional advocate transition note (≤1000 in DTO)
  actor_type      text        NOT NULL DEFAULT 'advocate',
  actor_id        uuid,                   -- users.id of the actor (NULL for system)
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT consultation_timeline_event_stage_check
    CHECK (stage_key IN (
      'consultation_started','advice_review','drafting','legal_notice',
      'filed_in_court','in_hearing','closed')),
  CONSTRAINT consultation_timeline_event_actor_check
    CHECK (actor_type IN ('advocate','citizen','system'))
);

CREATE INDEX IF NOT EXISTS idx_cte_consultation
  ON consultation_timeline_event (consultation_id, created_at);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'consultation_timeline_event_consultation_fk') THEN
    ALTER TABLE consultation_timeline_event ADD CONSTRAINT consultation_timeline_event_consultation_fk
      FOREIGN KEY (consultation_id) REFERENCES consultation_request (request_id) ON DELETE CASCADE;
  END IF;
END $$;

-- Backfill a single baseline 'consultation_started' event for any consultation that the
-- advocate has already accepted (or since closed) but has no timeline rows yet, so the
-- read-only view is never empty for existing data.
INSERT INTO consultation_timeline_event (consultation_id, stage_key, actor_type, created_at)
SELECT cr.request_id, 'consultation_started', 'system', COALESCE(cr.updated_at, cr.created_at, now())
  FROM consultation_request cr
 WHERE cr.status IN ('accepted','closed')
   AND NOT EXISTS (SELECT 1 FROM consultation_timeline_event e WHERE e.consultation_id = cr.request_id);
