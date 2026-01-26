-- Add location fields to technicians table
ALTER TABLE public.technicians
ADD COLUMN starting_address text,
ADD COLUMN location_type text NOT NULL DEFAULT 'office'
  CHECK (location_type IN ('office', 'home'));

-- Create drive time configuration table
CREATE TABLE public.drive_time_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Buffer tier configuration
  base_buffer_minutes integer NOT NULL DEFAULT 10,
  
  -- Drive time tiers (JSON array of {min_drive: X, max_drive: Y, buffer: Z})
  buffer_tiers jsonb NOT NULL DEFAULT '[
    {"min_drive": 0, "max_drive": 10, "buffer": 10},
    {"min_drive": 10, "max_drive": 25, "buffer": 20},
    {"min_drive": 25, "max_drive": 45, "buffer": 30}
  ]'::jsonb,
  
  -- Maximum acceptable drive time (minutes)
  max_drive_time_minutes integer NOT NULL DEFAULT 45,
  
  -- Allow long drives for first job of day
  allow_long_first_drive boolean NOT NULL DEFAULT true,
  
  -- Day boundary rules
  earliest_start_hour integer NOT NULL DEFAULT 9,
  latest_start_hour integer NOT NULL DEFAULT 16,
  
  -- Extra buffer before last job
  last_job_buffer_minutes integer NOT NULL DEFAULT 0,
  
  -- Disallow long drives as last job
  no_long_last_drive boolean NOT NULL DEFAULT true,
  
  -- Office address (starting point for techs who start from office)
  office_address text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.drive_time_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admins can manage drive time config"
  ON public.drive_time_config FOR ALL
  USING (is_admin());

CREATE POLICY "Public can view drive time config"
  ON public.drive_time_config FOR SELECT
  USING (true);

-- Insert default config
INSERT INTO public.drive_time_config (id) VALUES (gen_random_uuid());

-- Trigger for updated_at
CREATE TRIGGER update_drive_time_config_updated_at
  BEFORE UPDATE ON public.drive_time_config
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for technician location lookups
CREATE INDEX idx_technicians_location_type ON public.technicians(location_type);