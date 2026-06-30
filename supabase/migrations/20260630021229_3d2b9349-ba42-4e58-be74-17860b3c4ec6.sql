ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS sms_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_paused boolean NOT NULL DEFAULT false;