-- =============================================================
-- Migration 003: Add Cloudinary profile picture URL to users
-- Run this in Neon Console → SQL Editor
-- =============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT NULL;

-- Optional: add a comment so future devs know this is a Cloudinary URL
COMMENT ON COLUMN users.avatar_url IS 'Cloudinary image URL — e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/avatars/<user_id>.jpg';

-- Quick verify
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'avatar_url';