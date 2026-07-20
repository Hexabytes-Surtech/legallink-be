-- 015: Convert remaining naive `timestamp` columns to `timestamptz` (best practice).
--
-- Context: most instant columns are already timestamptz (migrations 013/014 etc.).
-- A live-DB audit on 2026-05-30 found only these naive columns on ACTIVE tables.
-- The booking timezone fix (Group B-2) did NOT need this — scheduled_at was already
-- timestamptz. This migration is purely consistency / best-practice cleanup.
--
-- Safety of the USING clause: existing naive values were written as UTC wall-clock
-- (the app writes `.toISOString()` and Neon's session TimeZone is UTC), so we
-- reinterpret them `AT TIME ZONE 'UTC'` to tag the correct instant. Default `now()`
-- expressions remain valid for timestamptz, so defaults are untouched.
--
-- Excluded intentionally:
--   * legacy `advocate` (singular) table — slated for removal (Group F).
--   * corpus tables `legal_document_unit` / `legal_unit` — already timestamptz; "do not modify".

ALTER TABLE consultation_request
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC',
  ALTER COLUMN updated_at TYPE timestamptz USING updated_at AT TIME ZONE 'UTC';

ALTER TABLE conversation_message
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';

ALTER TABLE matter
  ALTER COLUMN reviewed_at TYPE timestamptz USING reviewed_at AT TIME ZONE 'UTC';

ALTER TABLE matter_advocate_shortlist
  ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
