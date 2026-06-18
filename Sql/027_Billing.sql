-- 027 — Billing: advocate SaaS subscription (Razorpay, Orders / period-access model)
-- Run AFTER 026_CaseTimeline.sql
--
-- Monetization model (see docs/MONETIZATION_PLAN.md): LegalLink sells SOFTWARE to
-- advocates as a FLAT, fee-invariant subscription. It NEVER takes a cut of the legal
-- fee and NEVER sells visibility/ranking/leads. These tables record (a) the advocate's
-- tooling ENTITLEMENT and (b) an audit LEDGER of each platform→advocate software
-- payment (demonstrable as a SaaS invoice, not a share of any legal fee).
--
-- Compliance guardrails baked in here:
--   • The entitlement gates TOOLING ONLY — never discovery/reachability. A non-subscribing
--     verified advocate stays listed and can still receive/accept citizen-initiated
--     consultation requests (enforced in code via ActiveSubscriptionGuard placement).
--   • `amount` is the flat software price in paise; it is invariant to leads / earnings /
--     visibility. Same price for everyone — there is no per-lead or per-consultation charge.
--   • House conventions: CHECK constraints (no Postgres enum types), gen_random_uuid(),
--     timestamptz, IF NOT EXISTS idempotency.

-- ── 1. Advocate subscription — the tooling entitlement ──────────────────────────
-- One row per advocate user. Keyed on users.id (the paying account); advocate_id is
-- resolved at purchase time for domain joins/reporting. The guard checks user_id.
CREATE TABLE IF NOT EXISTS advocate_subscription (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL UNIQUE REFERENCES users(id)     ON DELETE CASCADE,
  advocate_id           uuid          REFERENCES advocates(id)        ON DELETE CASCADE,
  plan_id               text NOT NULL,                       -- e.g. advocate_pro_monthly | advocate_pro_yearly
  status                text NOT NULL DEFAULT 'inactive'
                        CHECK (status IN ('inactive','active','expired','cancelled')),
  current_period_start  timestamptz,
  current_period_end    timestamptz,                         -- entitlement expiry — what the guard checks
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adv_sub_user ON advocate_subscription(user_id);
-- Hot path for the entitlement guard: "is this user currently active?"
CREATE INDEX IF NOT EXISTS idx_adv_sub_active
  ON advocate_subscription(user_id, current_period_end) WHERE status = 'active';

-- ── 2. Billing payment ledger — audit trail of each SaaS payment ────────────────
-- Every Razorpay order is recorded here (created → paid|failed). This is the
-- "software-services invoice" evidence the monetization plan (§5.4) calls for: it is
-- explicitly platform→advocate for tooling, never linked to a consultation or a legal fee.
CREATE TABLE IF NOT EXISTS billing_payment (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  advocate_id           uuid          REFERENCES advocates(id) ON DELETE SET NULL,
  plan_id               text    NOT NULL,
  amount                integer NOT NULL,                     -- flat software price, in paise
  currency              text    NOT NULL DEFAULT 'INR',
  razorpay_order_id     text    NOT NULL UNIQUE,
  razorpay_payment_id   text    UNIQUE,
  razorpay_signature    text,
  status                text    NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created','paid','failed')),
  notes                 jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_payment_user  ON billing_payment(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_payment_order ON billing_payment(razorpay_order_id);
