
-- Authoritative per-attempt log of outbound emails. One row per intentional
-- send attempt so retries and corrected destinations remain auditable and
-- provider webhooks can update the exact attempt they refer to.
CREATE TABLE public.email_send_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NULL,
  template TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT NULL,
  status TEXT NOT NULL,
  failure_category TEXT NULL,
  failure_reason TEXT NULL,
  http_status INTEGER NULL,
  source_session_id TEXT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  bounced_at TIMESTAMPTZ NULL,
  complained_at TIMESTAMPTZ NULL,
  suppressed_at TIMESTAMPTZ NULL,
  last_event_at TIMESTAMPTZ NULL,
  last_event_type TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_send_attempts_status_chk CHECK (status IN
    ('accepted','failed','suppressed','delivered','bounced','complained'))
);

GRANT SELECT, INSERT, UPDATE ON public.email_send_attempts TO authenticated;
GRANT ALL ON public.email_send_attempts TO service_role;

ALTER TABLE public.email_send_attempts ENABLE ROW LEVEL SECURITY;

-- Admin-only read; writes come from edge functions using service_role.
CREATE POLICY "Admins can read email send attempts"
  ON public.email_send_attempts FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can write email send attempts"
  ON public.email_send_attempts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX email_send_attempts_quote_idx
  ON public.email_send_attempts (quote_id, submitted_at DESC);
CREATE INDEX email_send_attempts_provider_msg_idx
  ON public.email_send_attempts (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_send_attempts_recipient_idx
  ON public.email_send_attempts (lower(recipient_email), submitted_at DESC);

CREATE OR REPLACE FUNCTION public.email_send_attempts_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_email_send_attempts_updated_at
  BEFORE UPDATE ON public.email_send_attempts
  FOR EACH ROW EXECUTE FUNCTION public.email_send_attempts_touch_updated_at();
