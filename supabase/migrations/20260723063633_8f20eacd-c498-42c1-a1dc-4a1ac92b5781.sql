
ALTER TABLE public.sms_availability_presentations
  DROP CONSTRAINT IF EXISTS sms_availability_presentations_status_check;

ALTER TABLE public.sms_availability_presentations
  ADD CONSTRAINT sms_availability_presentations_status_check
  CHECK (status IN (
    'pending_send','active','superseded','expired',
    'consumed','cancelled','send_failed'
  ));

ALTER TABLE public.sms_availability_presentations
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS send_failure_reason TEXT,
  ADD COLUMN IF NOT EXISTS selection_inbound_sms_id UUID,
  ADD COLUMN IF NOT EXISTS selection_reply_text TEXT,
  ADD COLUMN IF NOT EXISTS selection_status TEXT
    CHECK (selection_status IS NULL OR selection_status IN
      ('selected','ambiguous','no_match','expired_options','gate_blocked','context_invalidated')),
  ADD COLUMN IF NOT EXISTS selection_option_number INTEGER,
  ADD COLUMN IF NOT EXISTS selected_slot_id TEXT,
  ADD COLUMN IF NOT EXISTS selected_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selected_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selection_parsed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS selection_ack_sms_id UUID,
  ADD COLUMN IF NOT EXISTS selection_invalidation_reason TEXT;

-- Idempotency: at most one presentation per (conversation, idempotency_key).
-- Any second call with the same key returns the existing row instead of
-- inserting/sending again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_presentations_convo_idem
  ON public.sms_availability_presentations (conversation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Dedupe per inbound selection reply so a repeated CallRail webhook cannot
-- produce two parse records against the same presentation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_presentations_selection_inbound
  ON public.sms_availability_presentations (id, selection_inbound_sms_id)
  WHERE selection_inbound_sms_id IS NOT NULL;
