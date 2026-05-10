-- =============================================================
-- Phase 1 Initial Schema Migration
-- Project: Citizen Legal Aid Platform
-- Target:  Neon PostgreSQL (raw SQL, no ORM)
-- Run:     Neon Console → SQL Editor  OR  via app on startup
-- =============================================================

-- Enable UUID generation (Neon supports this by default)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================
-- TABLE: users  (shared auth for citizens AND advocates)
-- Supports: phone OTP + email OTP + JWT refresh tokens
-- =============================================================
CREATE TABLE IF NOT EXISTS users (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ── Identity ──────────────────────────────────────────────
    phone                    VARCHAR(20)  UNIQUE,                  -- E.164 e.g. +919876543210 (nullable: user may register via email only)
    phone_verified           BOOLEAN      NOT NULL DEFAULT FALSE,

    email                    VARCHAR(255) UNIQUE,                  -- nullable: user may register via phone only
    email_verified           BOOLEAN      NOT NULL DEFAULT FALSE,

    role                     VARCHAR(20)  NOT NULL
                                 CHECK (role IN ('citizen', 'advocate', 'admin')),
    preferred_language       VARCHAR(2)   NOT NULL DEFAULT 'en'
                                 CHECK (preferred_language IN ('bn', 'en')),

    -- ── OTP (shared for both phone & email flows) ──────────────
    -- otp_type tells you WHICH channel this pending OTP belongs to
    otp_code                 VARCHAR(6),                           -- current hashed/plain 6-digit OTP
    otp_expires_at           TIMESTAMPTZ,                          -- NULL when no OTP is pending
    otp_type                 VARCHAR(10)
                                 CHECK (otp_type IN ('phone', 'email')),  -- which channel sent the OTP

    -- ── JWT refresh token ──────────────────────────────────────
    -- Store ONE active refresh token per user (simple single-device model).
    -- For multi-device support later, move this to a separate refresh_tokens table.
    refresh_token            TEXT,                                 -- hashed refresh token (never store plain)
    refresh_token_expires_at TIMESTAMPTZ,                         -- NULL = no active session

    -- ── Timestamps ────────────────────────────────────────────
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- ── Constraints ───────────────────────────────────────────
    -- At least one of phone or email must be present
    CONSTRAINT chk_users_contact CHECK (
        phone IS NOT NULL OR email IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_users_phone         ON users (phone)  WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email         ON users (email)  WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role          ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_refresh_token ON users (refresh_token) WHERE refresh_token IS NOT NULL;


-- =============================================================
-- TABLE: advocates  (extra profile for users with role='advocate')
-- =============================================================
CREATE TABLE IF NOT EXISTS advocates (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    bar_enrolment_number  VARCHAR(50) NOT NULL UNIQUE,       -- e.g. WB/1234/2018
    state_bar             VARCHAR(100) NOT NULL,             -- e.g. 'West Bengal'
    name                  VARCHAR(255) NOT NULL,             -- as per Certificate of Practice
    address               TEXT        NOT NULL,              -- as per Certificate of Practice
    phone                 VARCHAR(20) NOT NULL,              -- as per Certificate of Practice
    email                 VARCHAR(255),                      -- optional; not on CoP sometimes
    practice_areas        TEXT[]      NOT NULL DEFAULT '{}', -- e.g. {'traffic_offence','consumer'}
    courts                TEXT[]      NOT NULL DEFAULT '{}', -- e.g. {'Calcutta HC','Howrah District'}
    languages             TEXT[]      NOT NULL DEFAULT '{}', -- e.g. {'bn','en'}
    districts             TEXT[]      NOT NULL DEFAULT '{}', -- e.g. {'howrah','kolkata'}
    verification_status   VARCHAR(20) NOT NULL DEFAULT 'pending'
                              CHECK (verification_status IN ('pending', 'verified', 'rejected')),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advocates_user_id             ON advocates (user_id);
CREATE INDEX IF NOT EXISTS idx_advocates_verification_status ON advocates (verification_status);
-- GIN indexes for fast array filtering (matching queries)
CREATE INDEX IF NOT EXISTS idx_advocates_practice_areas      ON advocates USING GIN (practice_areas);
CREATE INDEX IF NOT EXISTS idx_advocates_districts           ON advocates USING GIN (districts);
CREATE INDEX IF NOT EXISTS idx_advocates_languages           ON advocates USING GIN (languages);


-- =============================================================
-- TABLE: advocate_verification_documents  (Certificate of Practice upload)
-- =============================================================
CREATE TABLE IF NOT EXISTS advocate_verification_documents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    advocate_id  UUID        NOT NULL REFERENCES advocates (id) ON DELETE CASCADE,
    file_path    VARCHAR(500) NOT NULL,   -- S3 / MinIO object key
    file_type    VARCHAR(100) NOT NULL,   -- MIME type e.g. application/pdf
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avd_advocate_id ON advocate_verification_documents (advocate_id);


-- =============================================================
-- TABLE: matters  (the core citizen entity)
-- =============================================================
CREATE TABLE IF NOT EXISTS matters (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID        REFERENCES users (id) ON DELETE SET NULL, -- NULL = anonymous
    session_id           UUID,                                                 -- links anonymous session
    query_text           TEXT        NOT NULL,
    query_language       VARCHAR(2)  NOT NULL CHECK (query_language IN ('bn', 'en')),
    classification       JSONB,      -- extracted fields: {type, statute, district, ...}
    citations            JSONB,      -- array of citation objects
    ai_response_english  TEXT,
    ai_response_bengali  TEXT,
    disclaimer           TEXT,
    status               VARCHAR(20) NOT NULL DEFAULT 'session-owned'
                             CHECK (status IN ('session-owned', 'user-owned', 'archived')),
    expires_at           TIMESTAMPTZ,  -- NULL if user-owned; 24h from creation if session-owned
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matters_user_id    ON matters (user_id);
CREATE INDEX IF NOT EXISTS idx_matters_session_id ON matters (session_id);
CREATE INDEX IF NOT EXISTS idx_matters_status     ON matters (status);
CREATE INDEX IF NOT EXISTS idx_matters_expires_at ON matters (expires_at)
    WHERE expires_at IS NOT NULL;   -- partial index: only session-owned matters expire


-- =============================================================
-- TABLE: documents  (citizen uploads attached to a matter)
-- =============================================================
CREATE TABLE IF NOT EXISTS documents (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id    UUID        NOT NULL REFERENCES matters (id) ON DELETE CASCADE,
    uploader_id  UUID        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    file_path    VARCHAR(500) NOT NULL,    -- S3 / MinIO object key
    file_type    VARCHAR(100) NOT NULL,    -- MIME type
    size         INT         NOT NULL CHECK (size > 0),  -- bytes
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_matter_id   ON documents (matter_id);
CREATE INDEX IF NOT EXISTS idx_documents_uploader_id ON documents (uploader_id);


-- =============================================================
-- TABLE: consultations  (links citizen + advocate on a matter)
-- =============================================================
CREATE TABLE IF NOT EXISTS consultations (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    matter_id     UUID        NOT NULL REFERENCES matters (id) ON DELETE RESTRICT,
    citizen_id    UUID        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    advocate_id   UUID        NOT NULL REFERENCES advocates (id) ON DELETE RESTRICT,
    status        VARCHAR(20) NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested', 'accepted', 'declined', 'closed')),
    requested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at   TIMESTAMPTZ                             -- NULL until advocate accepts
);

CREATE INDEX IF NOT EXISTS idx_consultations_matter_id   ON consultations (matter_id);
CREATE INDEX IF NOT EXISTS idx_consultations_citizen_id  ON consultations (citizen_id);
CREATE INDEX IF NOT EXISTS idx_consultations_advocate_id ON consultations (advocate_id);
CREATE INDEX IF NOT EXISTS idx_consultations_status      ON consultations (status);


-- =============================================================
-- TABLE: messages  (chat — persisted WebSocket messages)
-- =============================================================
CREATE TABLE IF NOT EXISTS messages (
    id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id    UUID        NOT NULL REFERENCES consultations (id) ON DELETE CASCADE,
    sender_type        VARCHAR(10) NOT NULL CHECK (sender_type IN ('citizen', 'advocate')),
    sender_id          UUID        NOT NULL,   -- users.id (citizen) or users.id via advocates
    content            TEXT        NOT NULL,
    moderation_status  VARCHAR(15) NOT NULL DEFAULT 'approved'
                           CHECK (moderation_status IN ('approved', 'pending', 'flagged')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_consultation_id ON messages (consultation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at      ON messages (consultation_id, created_at);


-- =============================================================
-- TRIGGER: auto-update updated_at on users and advocates
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to users
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Apply to advocates
DROP TRIGGER IF EXISTS trg_advocates_updated_at ON advocates;
CREATE TRIGGER trg_advocates_updated_at
    BEFORE UPDATE ON advocates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- =============================================================
-- QUICK SANITY CHECK (optional — run manually)
-- =============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;