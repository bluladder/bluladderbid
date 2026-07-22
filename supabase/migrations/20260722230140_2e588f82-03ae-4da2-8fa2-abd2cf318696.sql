ALTER TABLE public.customer_verification_challenges
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'sms'
    CHECK (channel IN ('sms','email')),
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_conversation_id text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_response_kind text,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS usable_until timestamptz,
  ADD COLUMN IF NOT EXISTS recipient_hint text;

ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_conversation_id text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_response_kind text,
  ADD COLUMN IF NOT EXISTS provider_accepted_at timestamptz;

CREATE INDEX IF NOT EXISTS ix_cvc_provider_conversation_id
  ON public.customer_verification_challenges(provider_conversation_id)
  WHERE provider_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cvc_provider_message_id
  ON public.customer_verification_challenges(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_conversation_id
  ON public.sms_messages(provider_conversation_id)
  WHERE provider_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_provider_message_id
  ON public.sms_messages(provider_message_id)
  WHERE provider_message_id IS NOT NULL;