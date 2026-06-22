-- Advocate self-reported case history.
-- Advocates populate this themselves; no client PII is stored here.
-- Used by the matching algorithm to score advocates on similar past wins
-- and local court familiarity.

CREATE TABLE public.advocate_case_history (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  advocate_id  UUID NOT NULL REFERENCES public.advocates(id) ON DELETE CASCADE,
  matter_type  TEXT NOT NULL,  -- canonical label: 'Criminal','Civil','Family','Labour','Tenancy','Traffic','Consumer'
  court        TEXT NOT NULL,
  district     TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('won', 'settled', 'ongoing')),
  year         SMALLINT CHECK (year >= 1950 AND year <= 2100),
  notes        TEXT CHECK (char_length(notes) <= 500),
  created_at   TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX advocate_case_history_advocate_idx   ON public.advocate_case_history(advocate_id);
CREATE INDEX advocate_case_history_type_outcome   ON public.advocate_case_history(matter_type, outcome);
CREATE INDEX advocate_case_history_district       ON public.advocate_case_history(district);
