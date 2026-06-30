ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS next_retry_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3;