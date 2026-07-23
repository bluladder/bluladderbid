
-- Resend webhook durability: dedup by svix-id and richer state tracking.

CREATE TABLE IF NOT EXISTS public.resend_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  svix_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  provider_message_id TEXT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.resend_webhook_events TO service_role;
ALTER TABLE public.resend_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.resend_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_msg
  ON public.resend_webhook_events(provider_message_id);

-- Extend email_send_attempts with sent/delayed lifecycle timestamps and states.
ALTER TABLE public.email_send_attempts
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delayed_at TIMESTAMPTZ NULL;

ALTER TABLE public.email_send_attempts
  DROP CONSTRAINT IF EXISTS email_send_attempts_status_chk;
ALTER TABLE public.email_send_attempts
  ADD CONSTRAINT email_send_attempts_status_chk CHECK (status IN
    ('accepted','sent','delayed','delivered','bounced','complained','failed','suppressed'));

CREATE INDEX IF NOT EXISTS idx_email_send_attempts_provider_msg
  ON public.email_send_attempts(provider_message_id);
