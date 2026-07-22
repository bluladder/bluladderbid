ALTER TABLE public.quote_sessions
  ADD COLUMN IF NOT EXISTS bid_request_status text,
  ADD COLUMN IF NOT EXISTS human_pricing_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS quote_sessions_bid_status_idx
  ON public.quote_sessions (bid_request_status)
  WHERE bid_request_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS quote_sessions_human_pricing_idx
  ON public.quote_sessions (human_pricing_required)
  WHERE human_pricing_required = true;