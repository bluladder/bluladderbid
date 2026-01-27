-- Ensure DB-backed availability cache can be upserted by cache_key
-- (required for jobber-availability edge function caching + throttling resilience)
CREATE UNIQUE INDEX IF NOT EXISTS availability_cache_cache_key_idx
  ON public.availability_cache (cache_key);

-- Helpful supporting indexes for range lookups
CREATE INDEX IF NOT EXISTS availability_cache_expires_at_idx
  ON public.availability_cache (expires_at);

CREATE INDEX IF NOT EXISTS availability_cache_range_idx
  ON public.availability_cache (from_date, to_date);
