-- =============================================================
-- Migration 004: Citizen table + user profile fields cleanup
-- Project: LegalLink
-- Run: Neon Console → SQL Editor
-- =============================================================
-- What this does:
--   1. Adds name + address to users (common profile fields for all roles)
--   2. Drops phone + phone_verified from users (platform is email-only; no phone exposed)
--   3. Creates citizens table (mirrors advocates pattern for role='citizen')
--   4. Updates documents FK → references matter (Schema B) instead of matters (Schema A)
--   5. Adds trigger for citizens.updated_at
-- =============================================================


-- ── 1. Add common profile fields to users ────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN users.name    IS 'Full display name — common to all roles';
COMMENT ON COLUMN users.address IS 'Home / correspondence address — common to all roles';


-- ── 2. Remove phone from users (no phone anywhere in the platform) ───────
--    Communication happens only through in-platform WebSocket chat.
ALTER TABLE users
  DROP COLUMN IF EXISTS phone,
  DROP COLUMN IF EXISTS phone_verified;

DROP INDEX IF EXISTS idx_users_phone;


-- ── 3. Create citizens table ──────────────────────────────────────────────
--    Mirrors the advocates pattern: one row per user where role = 'citizen'.
--    Auto-created by identity.service.ts on verify-otp (same as advocates).
CREATE TABLE IF NOT EXISTS citizens (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  -- Jurisdiction hints — used for advocate proximity matching
  state       VARCHAR(100) NOT NULL DEFAULT 'WB',   -- pilot geography: West Bengal
  district    VARCHAR(100),                          -- e.g. 'kolkata', 'howrah'

  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_citizens_user_id  ON citizens(user_id);
CREATE INDEX IF NOT EXISTS idx_citizens_district ON citizens(district) WHERE district IS NOT NULL;

COMMENT ON TABLE citizens IS
  'Citizen-specific profile row. One per user where role=citizen. Extended via users.name / users.address.';


-- ── 4. Trigger: auto-update updated_at on citizens ───────────────────────
--    set_updated_at() function already exists from migration 001.
DROP TRIGGER IF EXISTS trg_citizens_updated_at ON citizens;
CREATE TRIGGER trg_citizens_updated_at
  BEFORE UPDATE ON citizens
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ── 5. Re-point documents.matter_id FK → matter table (Schema B) ─────────
--    The old FK points to matters (Schema A, always empty).
--    matter (Schema B) is where citizen intake now lives.
--    Schema B DDL is NOT changed — this only updates our Schema A reference.
ALTER TABLE documents
  DROP CONSTRAINT IF EXISTS documents_matter_id_fkey;

ALTER TABLE documents
  ADD CONSTRAINT documents_matter_id_fkey
  FOREIGN KEY (matter_id) REFERENCES matter(matter_id) ON DELETE CASCADE;


-- ── Sanity check ──────────────────────────────────────────────────────────
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
FROM information_schema.columns c
WHERE c.table_name IN ('users', 'citizens')
ORDER BY c.table_name, c.ordinal_position;
