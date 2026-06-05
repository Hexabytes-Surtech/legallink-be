-- Add 'submitted' to the verification_status allowed values
ALTER TABLE advocates
  DROP CONSTRAINT advocates_verification_status_check;

ALTER TABLE advocates
  ADD CONSTRAINT advocates_verification_status_check
  CHECK (verification_status IN ('pending', 'submitted', 'verified', 'rejected'));

-- Track when advocate explicitly submitted for admin review
ALTER TABLE advocates
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;
