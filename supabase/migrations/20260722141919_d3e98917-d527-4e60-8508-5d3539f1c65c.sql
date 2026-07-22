
CREATE TABLE IF NOT EXISTS public.quote_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('voice','web','sms','chat')),
  conversation_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  customer_id uuid NULL,
  quote_id uuid NULL,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_remaining text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_step text NULL,
  quote_status text NOT NULL DEFAULT 'none',
  booking_ready boolean NOT NULL DEFAULT false,
  resume_token_id uuid NULL,
  phone_e164 text NULL,
  email_normalized text NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quote_sessions_phone_idx ON public.quote_sessions (phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS quote_sessions_email_idx ON public.quote_sessions (email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS quote_sessions_customer_idx ON public.quote_sessions (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quote_sessions_quote_idx ON public.quote_sessions (quote_id) WHERE quote_id IS NOT NULL;

GRANT ALL ON public.quote_sessions TO service_role;

ALTER TABLE public.quote_sessions ENABLE ROW LEVEL SECURITY;

-- No anon or authenticated policies: backend-only via service_role.
-- Admins retain access through existing has_admin_level checks used elsewhere.
CREATE POLICY "Admins can read quote sessions"
  ON public.quote_sessions
  FOR SELECT
  TO authenticated
  USING (is_admin() OR has_admin_level(auth.uid(), 'read_only_admin'));

CREATE OR REPLACE FUNCTION public.quote_sessions_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quote_sessions_touch ON public.quote_sessions;
CREATE TRIGGER trg_quote_sessions_touch
  BEFORE UPDATE ON public.quote_sessions
  FOR EACH ROW EXECUTE FUNCTION public.quote_sessions_touch_updated_at();

ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS quote_session_id uuid NULL;

CREATE INDEX IF NOT EXISTS chat_conversations_quote_session_idx
  ON public.chat_conversations (quote_session_id)
  WHERE quote_session_id IS NOT NULL;
