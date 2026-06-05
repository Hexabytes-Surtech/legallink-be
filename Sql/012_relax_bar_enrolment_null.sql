-- Allow NULL on bar_enrolment_number so advocates can register before filling their bar details.
-- PostgreSQL UNIQUE constraints treat each NULL as distinct, so multiple NULLs are allowed.
ALTER TABLE advocates
  ALTER COLUMN bar_enrolment_number DROP NOT NULL;
