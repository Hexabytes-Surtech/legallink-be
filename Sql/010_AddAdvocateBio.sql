-- Migration 010: Add bio column to advocates table
-- Required by Phase 2 — Public Advocate Directory (public /advocates/:id profile page)

ALTER TABLE advocates
  ADD COLUMN IF NOT EXISTS bio TEXT;
