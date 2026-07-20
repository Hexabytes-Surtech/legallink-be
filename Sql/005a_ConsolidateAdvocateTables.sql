-- ============================================================================
-- Migration: Consolidate advocate tables
-- Date:      2026-05-26
-- Purpose:   Make `advocates` (plural, NestJS-owned) the single source of truth.
--            Migrate AI team's seed data from `advocate` (singular) into it.
--            Repoint all FKs to `advocates.id`.
--            Replace `advocate` (singular) with a backward-compat VIEW so the
--            AI team's existing read queries continue to work.
--
-- IMPORTANT: Wrapped in a single transaction. If any step fails, nothing applies.
-- IMPORTANT: Run during a quiet window — the FK swap briefly blocks writes.
-- ============================================================================

BEGIN;

-- ── Step 1: Make advocates.user_id nullable ─────────────────────────────────
-- AI-team seed advocates don't have a corresponding users row. Allowing NULL
-- here lets us preserve them without inventing fake login accounts. Real
-- advocates that signed up via OTP will still have a user_id.
ALTER TABLE public.advocates ALTER COLUMN user_id DROP NOT NULL;

-- ── Step 2: Loosen overly-strict NOT NULLs that block seed import ───────────
-- The 6 seed rows from `advocate` don't have address/phone/state_bar.
ALTER TABLE public.advocates ALTER COLUMN address  DROP NOT NULL;
ALTER TABLE public.advocates ALTER COLUMN phone    DROP NOT NULL;
ALTER TABLE public.advocates ALTER COLUMN state_bar DROP NOT NULL;

-- ── Step 3: Import the 6 seed advocates from `advocate` (singular) ──────────
-- Preserve their UUIDs — `consultation_request` and `matter_advocate_shortlist`
-- already reference these IDs. Keeping the same UUIDs means no row updates
-- needed elsewhere.
INSERT INTO public.advocates
    (id, user_id, bar_enrolment_number, state_bar, name, address, phone,
     email, practice_areas, courts, languages, districts,
     verification_status, created_at, updated_at)
SELECT
    a.advocate_id,                              -- preserve UUID
    NULL,                                       -- no user account
    a.enrolment_number,                         -- column rename
    'WB',                                       -- inferred from enrolment prefix
    a.name,
    NULL,                                       -- no address in seed
    NULL,                                       -- no phone in seed
    NULL,                                       -- no email in seed
    a.practice_areas,
    ARRAY[]::text[],                            -- no courts in seed
    a.languages,
    a.districts,
    a.verification_status,
    COALESCE(a.created_at::timestamptz, now()),
    COALESCE(a.updated_at::timestamptz, now())
FROM public.advocate a
ON CONFLICT (id) DO NOTHING;                    -- defensive: skip if re-run

-- ── Step 4: Clean up the 2 stub rows from the `temp_<userid>` bug ──────────
-- These have empty names and temp bar numbers; they were created by the
-- identity.service.ts auto-insert during OTP signup but the users never
-- completed onboarding. Their associated users will keep working — they'll
-- just get a fresh `advocates` row on their next profile-save attempt
-- (after we fix the identity service to skip the temp insert — see ISSUES H4).
DELETE FROM public.advocates
WHERE bar_enrolment_number LIKE 'temp\_%' ESCAPE '\'
  AND name = ''
  AND (practice_areas IS NULL OR array_length(practice_areas, 1) IS NULL);

-- ── Step 5: Drop the old FK on consultation_request and re-point it ─────────
ALTER TABLE public.consultation_request
    DROP CONSTRAINT IF EXISTS consultation_request_advocate_id_fkey;

ALTER TABLE public.consultation_request
    ADD CONSTRAINT consultation_request_advocate_id_fkey
    FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE RESTRICT;

-- ── Step 6: Add the missing FK on matter_advocate_shortlist ────────────────
-- Currently unenforced — the 1 existing row references an advocate_id that
-- now lives in `advocates` after step 3, so this FK will validate cleanly.
ALTER TABLE public.matter_advocate_shortlist
    DROP CONSTRAINT IF EXISTS matter_advocate_shortlist_advocate_id_fkey;

ALTER TABLE public.matter_advocate_shortlist
    ADD CONSTRAINT matter_advocate_shortlist_advocate_id_fkey
    FOREIGN KEY (advocate_id) REFERENCES public.advocates(id) ON DELETE CASCADE;

-- ── Step 7: Replace `advocate` (singular) with a VIEW for AI-team compat ───
-- The AI service reads from `advocate` with columns: advocate_id, name,
-- enrolment_number, practice_areas, languages, districts, verification_status,
-- bio_text, created_at, updated_at. We expose exactly that shape from
-- `advocates` so the AI team's read queries keep working unchanged.
-- Writes via the view are not supported — but the AI team only reads.
DROP TABLE public.advocate;

CREATE VIEW public.advocate AS
SELECT
    id                   AS advocate_id,
    name,
    bar_enrolment_number AS enrolment_number,
    practice_areas,
    languages,
    districts,
    verification_status,
    NULL::text           AS bio_text,
    created_at,
    updated_at
FROM public.advocates;

-- ── Step 8: Quarantine the dead Schema A tables ────────────────────────────
-- These have 0 rows and are never queried by code. Rename rather than drop
-- so any accidental reference fails loudly. Drop after a week of green logs.
ALTER TABLE IF EXISTS public.matters       RENAME TO _dead_matters;
ALTER TABLE IF EXISTS public.consultations RENAME TO _dead_consultations;
ALTER TABLE IF EXISTS public.messages      RENAME TO _dead_messages;
ALTER TABLE IF EXISTS public.documents     RENAME TO _dead_documents;

COMMIT;

-- ============================================================================
-- Verification queries — run these AFTER the COMMIT to confirm:
--
--   SELECT count(*) FROM advocates;                           -- expect 6 (after temp cleanup)
--   SELECT count(*) FROM advocate;                            -- expect 6 (via view)
--   SELECT count(*) FROM consultation_request;                -- expect 2
--   SELECT * FROM consultation_request cr
--     JOIN advocates a ON a.id = cr.advocate_id;              -- expect 2 rows, all joining cleanly
--   \d advocate                                               -- should show "view"
--   \d+ _dead_matters                                         -- should still exist with 0 rows
-- ============================================================================
