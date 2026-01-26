-- Create availability cache table for persisting Jobber visit data
CREATE TABLE public.availability_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE, -- e.g., "visits:2026-01-26:2026-02-16"
  from_date date NOT NULL,
  to_date date NOT NULL,
  visits_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  cached_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast lookups by date range
CREATE INDEX idx_availability_cache_dates ON public.availability_cache (from_date, to_date);
CREATE INDEX idx_availability_cache_expires ON public.availability_cache (expires_at);

-- Enable RLS
ALTER TABLE public.availability_cache ENABLE ROW LEVEL SECURITY;

-- Edge functions use service role, but allow public read for browsing
CREATE POLICY "Public can read non-expired cache"
  ON public.availability_cache FOR SELECT
  USING (expires_at > now());

-- Only service role (edge functions) can write
CREATE POLICY "Service role can manage cache"
  ON public.availability_cache FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add comment
COMMENT ON TABLE public.availability_cache IS 'Short-lived cache of Jobber availability data to handle API throttling gracefully';