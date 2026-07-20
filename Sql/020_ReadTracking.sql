-- 020 — Per-participant read tracking for WhatsApp-style unread message counts
-- Run AFTER 019_CitizenReports.sql
--
-- The old `consultation_request.citizen_read` boolean only says "has new activity";
-- it can't produce a numeric "N unseen messages" badge. These two timestamps mark
-- each side's last-read position, so the unread count is simply the number of the
-- OTHER party's messages created after it.

ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS citizen_last_read_at  timestamptz;
ALTER TABLE consultation_request ADD COLUMN IF NOT EXISTS advocate_last_read_at timestamptz;

-- Backfill existing conversations to "read as of now" so applying this migration
-- doesn't suddenly light up every old chat with a huge unread count.
UPDATE consultation_request SET citizen_last_read_at  = now() WHERE citizen_last_read_at  IS NULL;
UPDATE consultation_request SET advocate_last_read_at = now() WHERE advocate_last_read_at IS NULL;
