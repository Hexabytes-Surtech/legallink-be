-- Anonymous matter auto-expiry (3 days from creation)
ALTER TABLE matter
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
-- Set on creation when citizen_id IS NULL
-- Cleared (NULL) when matter is claimed via OTP verify
-- Permanent matters (citizen_id IS NOT NULL) always have expires_at = NULL

-- Add ON DELETE CASCADE for matter_advocate_shortlist (not yet present in schema).
-- The other child tables (matter_brief_version, matter_citation, matter_event) already
-- have ON DELETE CASCADE in the live DB — no need to re-add them.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'matter_advocate_shortlist_matter_id_fkey'
      AND table_name = 'matter_advocate_shortlist'
  ) THEN
    ALTER TABLE matter_advocate_shortlist
      ADD CONSTRAINT matter_advocate_shortlist_matter_id_fkey
        FOREIGN KEY (matter_id) REFERENCES matter(matter_id) ON DELETE CASCADE;
  END IF;
END;
$$;
