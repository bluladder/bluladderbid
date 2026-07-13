-- Recurring-plan booking safety: idempotency + Jobber reference + confirmation timestamp on quotes.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS jobber_quote_id text,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone;

-- Enforce single-submission idempotency for server-created plan quotes.
CREATE UNIQUE INDEX IF NOT EXISTS quotes_idempotency_key_uidx
  ON public.quotes (idempotency_key)
  WHERE idempotency_key IS NOT NULL;