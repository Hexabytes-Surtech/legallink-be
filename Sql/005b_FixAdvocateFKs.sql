-- ============================================================================
-- Migration: Fix advocate foreign keys
-- Date:      2026-05-26
-- Purpose:   Re-point all FKs to `advocates` (plural, NestJS-owned table).
--            The `advocate` (singular) table is left completely untouched.
-- ============================================================================

BEGIN;

-- ── Step 1: Make advocates.user_id nullable ─────────────────────────────────
-- Advocates registered via OTP always have a user_id.
-- This just removes the NOT NULL so future edge cases don't block inserts.
ALTER TABLE public.advocates ALTER COLUMN user_id DROP NOT NULL;

-- ── Step 2: Fix consultation_request FK ──────────────────────────────────────
-- Currently points to advocate.advocate_id (singular table).
-- Re-point it to advocates.id (plural table).
ALTER TABLE public.consultation_request
    DROP CONSTRAINT IF EXISTS consultation_request_advocate_id_fkey;

ALTER TABLE public.consultation_request
    ADD CONSTRAINT consultation_request_advocate_id_fkey
    FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE RESTRICT;

-- ── Step 3: Fix matter_advocate_shortlist FK ─────────────────────────────────
-- Same issue — re-point to advocates.id.
ALTER TABLE public.matter_advocate_shortlist
    DROP CONSTRAINT IF EXISTS matter_advocate_shortlist_advocate_id_fkey;

ALTER TABLE public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_advocate_id_fkey
    FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;

COMMIT;

-- ============================================================================
-- Verification queries (run after COMMIT):
--   \d consultation_request        -- advocate_id FK should point to advocates
--   \d matter_advocate_shortlist   -- advocate_id FK should point to advocates
--   SELECT count(*) FROM advocates WHERE verification_status = 'verified';
-- ============================================================================
