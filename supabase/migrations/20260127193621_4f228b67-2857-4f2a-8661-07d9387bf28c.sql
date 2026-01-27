-- Add headers and raw_body columns to jobber_webhook_events for debug logging
ALTER TABLE public.jobber_webhook_events
ADD COLUMN IF NOT EXISTS headers jsonb NULL,
ADD COLUMN IF NOT EXISTS raw_body text NULL;

-- Make event_id nullable for debug entries (we generate one if missing)
ALTER TABLE public.jobber_webhook_events
ALTER COLUMN event_id DROP NOT NULL;

-- Make topic nullable for debug entries
ALTER TABLE public.jobber_webhook_events
ALTER COLUMN topic DROP NOT NULL;

-- Make payload nullable for debug entries (raw_body is the fallback)
ALTER TABLE public.jobber_webhook_events
ALTER COLUMN payload DROP NOT NULL;