-- Phase 4B — presentation state for slot options shown via SMS.
-- READ-ONLY with respect to scheduling: this table records WHAT the customer
-- was shown. It does NOT reserve capacity, does NOT hold a slot, and does NOT
-- imply any commitment. Slot holds/booking are a later, separate phase.

CREATE TABLE public.sms_availability_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Context fingerprint (all derived server-side; the model never supplies these).
  conversation_id UUID NOT NULL,
  quote_session_id UUID,
  property_id UUID,
  inputs_key TEXT,            -- quoteSession.sessionInputsKey(...) at present time
  pricing_version TEXT,       -- pricing engine version pinned to the shown quote
  quote_signature TEXT,       -- computeQuoteSignature(quote) for extra drift detection
  authoritative_duration_minutes INTEGER,
  canonical_total_cents INTEGER,

  -- The exact options the customer saw. Each element:
  --   { option_number:int, slot_id:text, start_at:tstz-iso, end_at:tstz-iso,
  --     timezone:text, date:date-iso, arrival_window_label:text,
  --     customer_label:text, preference_match:bool }
  options JSONB NOT NULL,

  -- Delivery evidence (where available).
  outbound_sms_id UUID,
  outbound_message_preview TEXT,

  -- Lifecycle.
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','superseded','expired','consumed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  superseded_by UUID REFERENCES public.sms_availability_presentations(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ,

  CONSTRAINT presentation_expiry_after_creation CHECK (expires_at > created_at)
);

-- Backend-only table (service_role from edge functions). No end-user access.
-- No GRANT to anon/authenticated: nothing on the client should read/write this.
GRANT ALL ON public.sms_availability_presentations TO service_role;

ALTER TABLE public.sms_availability_presentations ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated: table is intentionally inaccessible via PostgREST.

CREATE INDEX idx_sms_presentations_convo_recent
  ON public.sms_availability_presentations (conversation_id, created_at DESC);

CREATE INDEX idx_sms_presentations_active
  ON public.sms_availability_presentations (conversation_id, expires_at)
  WHERE status = 'active';