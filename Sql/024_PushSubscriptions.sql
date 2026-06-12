-- 024 — Web Push subscriptions (incoming-call notifications when the app is closed)
-- Run AFTER 023_Schema.sql
--
-- One row per browser/device a user has granted notification permission on. When a
-- call comes in, the backend sends a Web Push (VAPID) to these endpoints so a closed
-- PWA can wake its service worker and show an "incoming call" notification.
--   endpoint     — the push-service URL; UNIQUE, and the upsert/dedupe key
--   p256dh, auth — the subscription's encryption keys (from PushSubscription.getKey)
-- Dead endpoints (a push returns 404/410) are pruned by the backend automatically.

CREATE TABLE IF NOT EXISTS push_subscription (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL,
  endpoint    text        NOT NULL UNIQUE,
  p256dh      text        NOT NULL,
  auth        text        NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_sub_user ON push_subscription (user_id);

-- FK to users (idempotent — only add if missing); cascade so a deleted user's
-- subscriptions are removed with them.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscription_user_fk') THEN
    ALTER TABLE push_subscription ADD CONSTRAINT push_subscription_user_fk
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;
END $$;
