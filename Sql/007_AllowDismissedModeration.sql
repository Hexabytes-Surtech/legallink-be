-- =============================================================
-- 007_AllowDismissedModeration.sql
-- Supports H1 bug fix: dismiss writes 'dismissed' (not 'cleared').
-- Extends conversation_message.moderation_status CHECK to include 'dismissed'.
-- =============================================================

ALTER TABLE conversation_message
    DROP CONSTRAINT IF EXISTS conversation_message_moderation_status_check;

ALTER TABLE conversation_message
    ADD CONSTRAINT conversation_message_moderation_status_check
    CHECK (moderation_status IN ('cleared', 'flagged', 'pending', 'dismissed'));
