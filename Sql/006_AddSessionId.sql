-- =============================================================
-- 006_AddSessionId.sql
-- Phase B1: anonymous session support for matter
--
-- Anonymous citizens get a httpOnly cookie (legallink_session)
-- with a UUID. POST /api/matter stamps it on the matter row.
-- On OTP verify, identity.service runs:
--   UPDATE matter SET citizen_id=$user WHERE citizen_id IS NULL AND session_id=$cookie
-- so the anonymous matter is claimed by the freshly-authenticated user.
-- =============================================================

ALTER TABLE matter
    ADD COLUMN IF NOT EXISTS session_id UUID;

CREATE INDEX IF NOT EXISTS idx_matter_session_id
    ON matter (session_id)
    WHERE session_id IS NOT NULL;
