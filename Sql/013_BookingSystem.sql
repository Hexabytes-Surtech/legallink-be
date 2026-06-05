-- Phase 3: Booking / Availability System
-- Run AFTER 012_relax_bar_enrolment_null.sql

-- ── 1. Advocate weekly availability grid ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS advocate_availability (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  advocate_id           UUID        NOT NULL REFERENCES advocates(id) ON DELETE CASCADE,
  day_of_week           INT         NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Mon … 6=Sun
  start_time            TIME        NOT NULL,
  end_time              TIME        NOT NULL,
  slot_duration_minutes INT         NOT NULL DEFAULT 30 CHECK (slot_duration_minutes IN (15, 30, 60)),
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  CONSTRAINT chk_end_after_start CHECK (end_time > start_time),
  CONSTRAINT uq_advocate_day_start UNIQUE (advocate_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_avail_advocate_id ON advocate_availability(advocate_id);
CREATE INDEX IF NOT EXISTS idx_avail_day ON advocate_availability(advocate_id, day_of_week) WHERE is_active = true;

-- ── 2. Consultation appointment (booked slot) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS consultation_appointment (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE: one appointment per consultation request
  consultation_id   UUID        NOT NULL UNIQUE REFERENCES consultation_request(request_id) ON DELETE CASCADE,
  scheduled_at      TIMESTAMPTZ NOT NULL,
  duration_minutes  INT         NOT NULL DEFAULT 30,
  status            TEXT        NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  advocate_notes    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appt_consultation_id ON consultation_appointment(consultation_id);
CREATE INDEX IF NOT EXISTS idx_appt_scheduled_at   ON consultation_appointment(scheduled_at);
