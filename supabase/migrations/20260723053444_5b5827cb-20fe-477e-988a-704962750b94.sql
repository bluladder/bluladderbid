
-- 1. SMS-native booking confirmation ledger (distinct from `pending_confirmations`
--    which handles reschedule/cancel proposals for existing bookings).
CREATE TABLE public.sms_booking_confirmations (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id             UUID NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  customer_id                 UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  property_id                 UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  quote_session_id            UUID REFERENCES public.quote_sessions(id) ON DELETE SET NULL,
  slot_group_id               UUID,
  crew_ids                    TEXT[] NOT NULL,
  scheduled_start             TIMESTAMPTZ NOT NULL,
  scheduled_end               TIMESTAMPTZ NOT NULL,
  services_json               JSONB NOT NULL,
  authoritative_total         NUMERIC(10,2) NOT NULL,
  pricing_version             INTEGER NOT NULL,
  summary_text                TEXT NOT NULL,
  outbound_sms_id             UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  inbound_confirmation_sms_id UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  confirmation_requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at                TIMESTAMPTZ,
  booking_id                  UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  status                      TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','expired','superseded','failed','staff_escalated')),
  failure_reason              TEXT,
  idempotency_key             TEXT NOT NULL UNIQUE,
  expires_at                  TIMESTAMPTZ NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.sms_booking_confirmations TO authenticated;
GRANT ALL ON public.sms_booking_confirmations TO service_role;
ALTER TABLE public.sms_booking_confirmations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view sms booking confirmations"
  ON public.sms_booking_confirmations FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE INDEX ix_smsbc_conversation_pending
  ON public.sms_booking_confirmations (conversation_id)
  WHERE status = 'pending';
CREATE INDEX ix_smsbc_expires
  ON public.sms_booking_confirmations (expires_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.smsbc_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER trg_smsbc_touch
  BEFORE UPDATE ON public.sms_booking_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.smsbc_touch_updated_at();

-- 2. Confirmed-email identity anchor on the conversation. When phone
--    resolution is ambiguous, the AI asks once for the customer's email;
--    an exact case-insensitive match to one of the phone-sharing candidates
--    persists a durable, deterministic anchor here. No email is stored
--    until a match is confirmed.
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS confirmed_email          TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_email_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_email_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_email_sms_id   UUID REFERENCES public.sms_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_autoreply_paused      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_autoreply_paused_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_autoreply_paused_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS awaiting_email_disambiguation BOOLEAN NOT NULL DEFAULT false;

-- 3. Global AI SMS kill switch on the existing config row.
ALTER TABLE public.system_test_config
  ADD COLUMN IF NOT EXISTS ai_sms_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_sms_autobook_enabled BOOLEAN NOT NULL DEFAULT true;

-- 4. Correct the existing gutter conversation: the phone resolver returned
--    ambiguous, but downstream enrichment silently promoted the newest quote's
--    customer to be the thread's identity. That was not a deterministic
--    anchor. Clear customer_id, keep property_id, and mark it as awaiting
--    email disambiguation. c867029e was never a real anchor here.
UPDATE public.chat_conversations
   SET customer_id = NULL,
       resolution_method = 'ambiguous',
       resolution_confidence = 'ambiguous',
       unresolved_reason = 'multiple_customers_share_phone',
       awaiting_email_disambiguation = true
 WHERE channel = 'sms'
   AND prospect_phone = '+14692150144'
   AND customer_id = 'c867029e-9de5-4bc3-8b7e-8adba4a1eeb1'::uuid;
