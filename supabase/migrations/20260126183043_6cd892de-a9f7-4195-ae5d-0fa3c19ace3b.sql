-- Add per-technician scheduling configuration
ALTER TABLE public.technicians
ADD COLUMN IF NOT EXISTS schedule_start_hour integer DEFAULT 9,
ADD COLUMN IF NOT EXISTS schedule_end_hour integer DEFAULT 17,
ADD COLUMN IF NOT EXISTS work_days jsonb DEFAULT '[1, 2, 3, 4, 5]'::jsonb,
ADD COLUMN IF NOT EXISTS buffer_minutes integer DEFAULT NULL,
ADD COLUMN IF NOT EXISTS max_drive_time_minutes integer DEFAULT NULL;

-- Add comments for clarity
COMMENT ON COLUMN public.technicians.schedule_start_hour IS 'Hour (0-23) when this technician starts their day';
COMMENT ON COLUMN public.technicians.schedule_end_hour IS 'Hour (0-23) when this technician ends their day';
COMMENT ON COLUMN public.technicians.work_days IS 'Array of days (0=Sunday, 1=Monday, etc.) this technician works';
COMMENT ON COLUMN public.technicians.buffer_minutes IS 'Custom buffer minutes for this technician (NULL = use global)';
COMMENT ON COLUMN public.technicians.max_drive_time_minutes IS 'Custom max drive time for this technician (NULL = use global)';