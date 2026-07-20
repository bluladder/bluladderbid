
-- Extend quotes table for persisted-quote abandonment tracking. Non-breaking:
-- all columns are nullable and defaulted where needed.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS abandonment_emitted_version TEXT,
  ADD COLUMN IF NOT EXISTS abandonment_swept_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMP WITH TIME ZONE;

-- Partial index driving the oldest-first candidate scan for the persisted-quote
-- sweep. Only unbooked, non-superseded, firm-status rows participate.
CREATE INDEX IF NOT EXISTS idx_quotes_abandonment_candidates
  ON public.quotes (last_activity_at)
  WHERE converted_booking_id IS NULL
    AND superseded_at IS NULL
    AND status IN ('saved','emailed','viewed','pending');
