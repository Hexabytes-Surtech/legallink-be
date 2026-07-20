-- Phase 4: Feedback & Rating
-- consultation_feedback — one row per closed consultation, citizen-authored

CREATE TABLE IF NOT EXISTS consultation_feedback (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id   UUID        UNIQUE NOT NULL
                                  REFERENCES consultation_request(request_id) ON DELETE CASCADE,
  citizen_id        UUID        NOT NULL
                                  REFERENCES users(id) ON DELETE RESTRICT,
  advocate_id       UUID        NOT NULL
                                  REFERENCES advocates(id) ON DELETE RESTRICT,
  rating            INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment           TEXT,
  is_visible        BOOLEAN     NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_advocate_id
  ON consultation_feedback(advocate_id);

CREATE INDEX IF NOT EXISTS idx_feedback_created_at
  ON consultation_feedback(created_at DESC);
