-- 017 — QA hardening migration
-- Run AFTER 016_Schema.sql
--
-- Brings source control back in sync with two changes that the running Neon DB
-- already needs but that were never captured as migrations:
--   1. advocates.rejection_reason — added by a manual ALTER during QA (BUG-011).
--      Code in admin.service / advocate.service reads & writes it; a fresh DB
--      provisioned only from Sql/ would 500 without this column.
--   2. A real, atomic guard against double-booking an advocate's time slot. The
--      booking + reschedule paths did a check-then-insert under READ COMMITTED,
--      which is not atomic. A partial unique index on (advocate_id, scheduled_at)
--      for status='scheduled' makes the database the single source of truth.

-- ── 1. rejection_reason (idempotent) ───────────────────────────────────────────
ALTER TABLE advocates ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ── 2. Denormalise advocate_id onto the appointment row ─────────────────────────
-- Needed because a partial unique index can only reference columns on this table,
-- and the advocate previously lived only on consultation_request via a join.
ALTER TABLE consultation_appointment
  ADD COLUMN IF NOT EXISTS advocate_id UUID REFERENCES advocates(id) ON DELETE CASCADE;

-- Backfill existing rows from their consultation request.
UPDATE consultation_appointment ca
   SET advocate_id = cr.advocate_id
  FROM consultation_request cr
 WHERE cr.request_id = ca.consultation_id
   AND ca.advocate_id IS NULL;

-- Every appointment must belong to an advocate going forward.
ALTER TABLE consultation_appointment ALTER COLUMN advocate_id SET NOT NULL;

-- ── 3. Atomic no-double-booking guarantee ──────────────────────────────────────
-- Only one LIVE (scheduled) appointment may exist per advocate + instant. Cancelled
-- / completed rows are excluded so a freed slot can be re-booked.
CREATE UNIQUE INDEX IF NOT EXISTS uq_appt_advocate_slot
  ON consultation_appointment (advocate_id, scheduled_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_appt_advocate_id ON consultation_appointment(advocate_id);
