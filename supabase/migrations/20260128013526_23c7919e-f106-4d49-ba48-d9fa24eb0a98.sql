-- Phase 2: Add max_stories to technicians and extend big_job_settings

-- Add max_stories to technicians table (null means no limit)
ALTER TABLE public.technicians 
ADD COLUMN IF NOT EXISTS max_stories integer DEFAULT NULL;

COMMENT ON COLUMN public.technicians.max_stories IS 'Maximum property stories this technician can work on. NULL = no limit.';

-- Add new columns to big_job_settings for Phase 2
ALTER TABLE public.big_job_settings
ADD COLUMN IF NOT EXISTS workday_start_time time DEFAULT '09:00:00',
ADD COLUMN IF NOT EXISTS workday_end_time time DEFAULT '17:00:00',
ADD COLUMN IF NOT EXISTS workday_length_hours numeric DEFAULT 8,
ADD COLUMN IF NOT EXISTS min_buffer_minutes integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS big_job_trigger_mode text DEFAULT 'FITS_IN_DAY',
ADD COLUMN IF NOT EXISTS pairing_mode text DEFAULT 'RESTRICTED';

COMMENT ON COLUMN public.big_job_settings.big_job_trigger_mode IS 'PRICE_ONLY, HOURS_ONLY, PRICE_OR_HOURS, or FITS_IN_DAY';
COMMENT ON COLUMN public.big_job_settings.pairing_mode IS 'AUTO_PAIR, RESTRICTED (eligible_for_big_job_pairing only), or PREFER_LIST';

-- Update default settings row with new values
UPDATE public.big_job_settings
SET 
  workday_start_time = '09:00:00',
  workday_end_time = '17:00:00',
  workday_length_hours = 8,
  min_buffer_minutes = 30,
  big_job_trigger_mode = 'FITS_IN_DAY',
  pairing_mode = 'RESTRICTED'
WHERE id = 'default';