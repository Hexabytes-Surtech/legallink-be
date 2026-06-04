-- 019 — Citizen reports (advocate reports a citizen after a consultation closes)
-- Run AFTER 018_ChatAttachments.sql
--
-- Fairness counterweight to the citizen-can-close flow: a citizen may end a
-- consultation unilaterally, but once it's closed the advocate can file ONE report
-- on that citizen. Reports land in an admin queue (status='open') for review.
--
--   reason  — fixed category for triage
--   note    — advocate's free-text detail (optional)
--   status  — open (awaiting admin) | reviewed (admin acted) | dismissed (no action)
--   one report per consultation (uq_report_consultation)

CREATE TABLE IF NOT EXISTS citizen_report (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid        NOT NULL,   -- consultation_request.request_id
  advocate_id     uuid        NOT NULL,   -- advocates.id (the reporter)
  citizen_id      uuid        NOT NULL,   -- users.id (the reported citizen)
  reason          text        NOT NULL,
  note            text,
  status          text        NOT NULL DEFAULT 'open',
  admin_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz,

  CONSTRAINT citizen_report_reason_check
    CHECK (reason IN ('abusive', 'spam', 'ended_unfairly', 'off_platform_contact', 'other')),
  CONSTRAINT citizen_report_status_check
    CHECK (status IN ('open', 'reviewed', 'dismissed'))
);

-- One report per consultation — the advocate gets a single shot; re-reporting is blocked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_consultation
  ON citizen_report (consultation_id);

CREATE INDEX IF NOT EXISTS idx_report_status  ON citizen_report (status);
CREATE INDEX IF NOT EXISTS idx_report_created ON citizen_report (created_at DESC);

-- Foreign keys (idempotent — only add if missing).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citizen_report_consultation_fk') THEN
    ALTER TABLE citizen_report ADD CONSTRAINT citizen_report_consultation_fk
      FOREIGN KEY (consultation_id) REFERENCES consultation_request (request_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citizen_report_advocate_fk') THEN
    ALTER TABLE citizen_report ADD CONSTRAINT citizen_report_advocate_fk
      FOREIGN KEY (advocate_id) REFERENCES advocates (id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'citizen_report_citizen_fk') THEN
    ALTER TABLE citizen_report ADD CONSTRAINT citizen_report_citizen_fk
      FOREIGN KEY (citizen_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;
END $$;
