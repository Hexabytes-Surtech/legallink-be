-- Citizen-side unread flag for badge count on chat icon
ALTER TABLE consultation_request
  ADD COLUMN IF NOT EXISTS citizen_read BOOLEAN DEFAULT TRUE;
-- TRUE  = citizen has seen the latest status
-- FALSE = advocate changed status, citizen hasn't seen it yet
