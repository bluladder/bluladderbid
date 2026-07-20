
CREATE TABLE IF NOT EXISTS public.email_reply_tokens (
  id TEXT PRIMARY KEY,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  quote_id UUID,
  booking_id UUID,
  purpose TEXT NOT NULL DEFAULT 'reply',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

GRANT SELECT ON public.email_reply_tokens TO authenticated;
GRANT ALL ON public.email_reply_tokens TO service_role;
ALTER TABLE public.email_reply_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email reply tokens"
  ON public.email_reply_tokens
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS email_reply_tokens_conversation_idx
  ON public.email_reply_tokens(conversation_id);

CREATE TABLE IF NOT EXISTS public.email_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  conversation_id UUID REFERENCES public.chat_conversations(id) ON DELETE SET NULL,
  reply_token_id TEXT REFERENCES public.email_reply_tokens(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_error TEXT
);

GRANT SELECT ON public.email_inbound_messages TO authenticated;
GRANT ALL ON public.email_inbound_messages TO service_role;
ALTER TABLE public.email_inbound_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view inbound email"
  ON public.email_inbound_messages
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS email_inbound_messages_provider_msg_idx
  ON public.email_inbound_messages(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_inbound_messages_conversation_idx
  ON public.email_inbound_messages(conversation_id);
