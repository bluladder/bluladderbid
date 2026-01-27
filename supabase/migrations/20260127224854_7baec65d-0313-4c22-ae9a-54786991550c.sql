-- Create drive_time_cache table for caching real routing API results
CREATE TABLE public.drive_time_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  origin_hash text NOT NULL,
  dest_hash text NOT NULL,
  drive_minutes integer NOT NULL,
  distance_meters integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '30 days'),
  UNIQUE(origin_hash, dest_hash)
);

-- Create index for fast lookups
CREATE INDEX idx_drive_time_cache_hashes ON public.drive_time_cache (origin_hash, dest_hash);
CREATE INDEX idx_drive_time_cache_expires ON public.drive_time_cache (expires_at);

-- Enable RLS
ALTER TABLE public.drive_time_cache ENABLE ROW LEVEL SECURITY;

-- Anyone can read cache (for availability checks)
CREATE POLICY "Anyone can read drive time cache"
  ON public.drive_time_cache
  FOR SELECT
  USING (true);

-- Only service role can insert/update (edge functions)
CREATE POLICY "Service role can manage cache"
  ON public.drive_time_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add trigger for updated_at
CREATE TRIGGER update_drive_time_cache_updated_at
  BEFORE UPDATE ON public.drive_time_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add autosync_config table for managing near-term and far-term sync schedules
CREATE TABLE public.autosync_config (
  id text PRIMARY KEY DEFAULT 'default',
  near_term_interval_minutes integer NOT NULL DEFAULT 30,
  near_term_horizon_days integer NOT NULL DEFAULT 30,
  far_term_daily_chunk_days integer NOT NULL DEFAULT 30,
  far_term_max_horizon_days integer NOT NULL DEFAULT 365,
  last_near_term_sync timestamp with time zone,
  last_far_term_sync timestamp with time zone,
  far_term_current_horizon_days integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Insert default config
INSERT INTO public.autosync_config (id) VALUES ('default');

-- Enable RLS
ALTER TABLE public.autosync_config ENABLE ROW LEVEL SECURITY;

-- Public can read
CREATE POLICY "Public can read autosync config"
  ON public.autosync_config
  FOR SELECT
  USING (true);

-- Admins can manage
CREATE POLICY "Admins can manage autosync config"
  ON public.autosync_config
  FOR ALL
  USING (is_admin());