-- =============================================================
-- Migration 002: Switch to email-only OTP verification
-- Run this in Neon Console → SQL Editor
-- Tables already exist — this only ALTERs the users table
-- =============================================================


-- 1. Drop the phone UNIQUE constraint (phone is now just stored, not verified)
--    First find the constraint name — it was auto-named by Postgres.
--    In our schema it was created as UNIQUE inline, so Postgres named it: users_phone_key
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_key;


-- 2. Drop the "at least one of phone/email" check — email will be mandatory now
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_contact;


-- 3. Drop otp_type — only one channel (email) so this column is redundant
ALTER TABLE users DROP COLUMN IF EXISTS otp_type;


-- 4. Make email NOT NULL (it is now the primary identity + verification channel)
--    Step A: fill any existing NULL emails before adding NOT NULL (safe for fresh DB)
UPDATE users SET email = 'placeholder_' || id || '@fix.me' WHERE email IS NULL;
--    Step B: now enforce NOT NULL
ALTER TABLE users ALTER COLUMN email SET NOT NULL;


-- 5. Make phone fully optional and nullable (no unique, no not-null)
--    Already nullable from migration 001 — nothing to do.
--    Just confirming: phone stores the number for display/contact only.


-- 6. Add a UNIQUE constraint on email explicitly (clean naming)
ALTER TABLE users ADD CONSTRAINT uq_users_email UNIQUE (email);


-- 7. Drop the old partial index on phone (it checked WHERE phone IS NOT NULL — still fine to keep,
--    but rename for clarity. Dropping and recreating with a better name.)
DROP INDEX IF EXISTS idx_users_phone;
CREATE INDEX IF NOT EXISTS idx_users_phone ON users (phone) WHERE phone IS NOT NULL;


-- =============================================================
-- Final shape of auth-related columns in users:
--
--   email                    VARCHAR(255) NOT NULL UNIQUE   ← identity + OTP channel
--   email_verified           BOOLEAN      DEFAULT FALSE
--   phone                    VARCHAR(20)  NULL              ← optional, stored only
--   phone_verified           BOOLEAN      DEFAULT FALSE     ← keep but will stay FALSE
--   otp_code                 VARCHAR(6)   NULL              ← current pending OTP (hashed)
--   otp_expires_at           TIMESTAMPTZ  NULL              ← OTP expiry
--   refresh_token            TEXT         NULL              ← hashed JWT refresh token
--   refresh_token_expires_at TIMESTAMPTZ  NULL              ← session expiry
-- =============================================================


-- Quick verify — run this to confirm the final columns:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;