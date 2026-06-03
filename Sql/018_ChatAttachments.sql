-- 018 — Chat attachments (citizen → advocate file sharing inside a consultation)
-- Run AFTER 017_QaHardening.sql
--
-- Attachments are modelled as normal conversation_message rows with the file fields
-- populated (content stays '' for a pure attachment). Citizens can soft-delete their
-- own attachments via deleted_at. Only images and PDFs are accepted (enforced in code).

ALTER TABLE conversation_message ADD COLUMN IF NOT EXISTS attachment_url   text;
ALTER TABLE conversation_message ADD COLUMN IF NOT EXISTS attachment_type  text;     -- 'image' | 'pdf'
ALTER TABLE conversation_message ADD COLUMN IF NOT EXISTS attachment_name  text;
ALTER TABLE conversation_message ADD COLUMN IF NOT EXISTS attachment_size  integer;
ALTER TABLE conversation_message ADD COLUMN IF NOT EXISTS deleted_at       timestamp;

-- Optional sanity guard on the attachment kind.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'conversation_message_attachment_type_check'
  ) THEN
    ALTER TABLE conversation_message
      ADD CONSTRAINT conversation_message_attachment_type_check
      CHECK (attachment_type IS NULL OR attachment_type IN ('image', 'pdf'));
  END IF;
END $$;
