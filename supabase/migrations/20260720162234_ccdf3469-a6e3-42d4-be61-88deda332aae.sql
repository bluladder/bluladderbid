-- Conversations workspace: inbound email + reply tokens

CREATE TABLE IF NOT EXISTS public.email_reply_tokens (
  token TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  quote_id UUID,
  booking_id UUID,
  customer_id UUID,
  recipient_email TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '365 days'),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_reply_tokens TO authenticated;
GRANT ALL ON public.email_reply_tokens TO service_role;
ALTER TABLE public.email_reply_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read email_reply_tokens" ON public.email_reply_tokens
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Admins manage email_reply_tokens" ON public.email_reply_tokens
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS email_reply_tokens_conversation_idx
  ON public.email_reply_tokens (conversation_id);

CREATE TABLE IF NOT EXISTS public.email_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'resend',
  provider_message_id TEXT UNIQUE,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  reply_token TEXT REFERENCES public.email_reply_tokens(token) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  quote_id UUID,
  booking_id UUID,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  suppressed BOOLEAN NOT NULL DEFAULT false,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.email_inbound_messages TO authenticated;
GRANT ALL ON public.email_inbound_messages TO service_role;
ALTER TABLE public.email_inbound_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read email_inbound_messages" ON public.email_inbound_messages
  FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Admins update email_inbound_messages" ON public.email_inbound_messages
  FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE INDEX IF NOT EXISTS email_inbound_messages_conversation_idx
  ON public.email_inbound_messages (conversation_id, received_at DESC);
CREATE INDEX IF NOT EXISTS email_inbound_messages_received_idx
  ON public.email_inbound_messages (received_at DESC);
