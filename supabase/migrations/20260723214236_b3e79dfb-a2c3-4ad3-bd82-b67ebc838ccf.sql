
-- Phase 6B.3.1: outbox columns on sms_messages
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS outbox_state text,
  ADD COLUMN IF NOT EXISTS send_claim_token uuid,
  ADD COLUMN IF NOT EXISTS send_claim_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_error_code text,
  ADD COLUMN IF NOT EXISTS send_error_at timestamptz;

-- Legal outbox_state values (nullable — legacy rows and non-outbox sends stay NULL).
ALTER TABLE public.sms_messages DROP CONSTRAINT IF EXISTS sms_messages_outbox_state_check;
ALTER TABLE public.sms_messages
  ADD CONSTRAINT sms_messages_outbox_state_check CHECK (
    outbox_state IS NULL OR outbox_state IN (
      'pending_send','sending','provider_accepted','send_failed','delivery_unknown'
    )
  );

CREATE INDEX IF NOT EXISTS idx_sms_messages_outbox_state
  ON public.sms_messages(outbox_state)
  WHERE outbox_state IS NOT NULL;

-- Phase 6B.3.2: booking_timezone persisted on the ledger
ALTER TABLE public.sms_booking_confirmations
  ADD COLUMN IF NOT EXISTS booking_timezone text;

-- Phase 6B.3.3: outbox claim RPC
-- Inserts a `sending` row keyed by outbound_idempotency_key. Because a UNIQUE
-- index already exists on that column, ON CONFLICT DO NOTHING makes this
-- atomically-idempotent: at most one row wins. Returns the row plus a flag
-- indicating whether the caller is the winner (safe to dispatch) or a
-- follower (must NOT re-dispatch; treat existing row as authoritative).
CREATE OR REPLACE FUNCTION public.claim_sms_outbox_send(
  p_outbound_key text,
  p_claim_token uuid,
  p_to_number text,
  p_body text,
  p_message_kind text,
  p_stale_claim_seconds int DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_messages%ROWTYPE;
  v_new_id uuid;
  v_stale boolean;
BEGIN
  IF p_outbound_key IS NULL OR btrim(p_outbound_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_outbound_key');
  END IF;

  INSERT INTO public.sms_messages (
    to_number, body, message_kind, status, outbound_idempotency_key,
    outbox_state, send_claim_token, send_claim_at
  ) VALUES (
    p_to_number, p_body, p_message_kind, 'processing'::sms_status, p_outbound_key,
    'sending', p_claim_token, now()
  )
  ON CONFLICT (outbound_idempotency_key) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.sms_messages WHERE id = v_new_id;
    RETURN jsonb_build_object(
      'ok', true, 'is_new', true, 'id', v_row.id,
      'outbox_state', v_row.outbox_state, 'may_dispatch', true
    );
  END IF;

  -- Existing row wins.
  SELECT * INTO v_row FROM public.sms_messages
   WHERE outbound_idempotency_key = p_outbound_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'row_disappeared');
  END IF;

  -- Terminal outcomes: replay existing evidence, do not re-dispatch.
  IF v_row.outbox_state IN ('provider_accepted','send_failed','delivery_unknown')
     OR v_row.status IN ('sent','failed') THEN
    RETURN jsonb_build_object(
      'ok', true, 'is_new', false, 'id', v_row.id,
      'outbox_state', v_row.outbox_state, 'status', v_row.status,
      'may_dispatch', false, 'replay', true,
      'provider_message_id', v_row.provider_message_id
    );
  END IF;

  -- In-flight claim: only reclaim if stale.
  IF v_row.outbox_state = 'sending' THEN
    v_stale := (v_row.send_claim_at IS NULL)
      OR (now() - v_row.send_claim_at > make_interval(secs => p_stale_claim_seconds));
    IF NOT v_stale THEN
      RETURN jsonb_build_object(
        'ok', true, 'is_new', false, 'id', v_row.id,
        'outbox_state', v_row.outbox_state,
        'may_dispatch', false, 'in_progress', true
      );
    END IF;
    -- Stale sending: cannot safely re-dispatch (provider may have accepted
    -- but our recorder crashed). Escalate to delivery_unknown for
    -- reconciliation and refuse dispatch.
    UPDATE public.sms_messages
       SET outbox_state = 'delivery_unknown',
           send_error_code = 'stale_claim_escalated',
           send_error_at = now(),
           updated_at = now()
     WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'ok', true, 'is_new', false, 'id', v_row.id,
      'outbox_state', 'delivery_unknown',
      'may_dispatch', false, 'escalated', true
    );
  END IF;

  -- pending_send or NULL — safe to reclaim.
  UPDATE public.sms_messages
     SET outbox_state = 'sending',
         send_claim_token = p_claim_token,
         send_claim_at = now(),
         updated_at = now()
   WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok', true, 'is_new', false, 'id', v_row.id,
    'outbox_state', 'sending', 'may_dispatch', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sms_outbox_send(text, uuid, text, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_outbox_send(text, uuid, text, text, text, int) TO service_role;

-- Phase 6B.3.4: outbox finalize RPC. Requires the claim token — a stale
-- worker cannot overwrite a successor's finalization.
CREATE OR REPLACE FUNCTION public.finalize_sms_outbox_send(
  p_sms_message_id uuid,
  p_claim_token uuid,
  p_new_state text,
  p_provider_message_id text,
  p_provider_conversation_id text,
  p_provider_status text,
  p_provider_response_kind text,
  p_error text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_messages%ROWTYPE;
  v_new_status public.sms_status;
BEGIN
  IF p_new_state NOT IN ('provider_accepted','send_failed','delivery_unknown') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_new_state');
  END IF;

  SELECT * INTO v_row FROM public.sms_messages
   WHERE id = p_sms_message_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'row_missing');
  END IF;

  IF v_row.send_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'claim_token_mismatch',
      'current_state', v_row.outbox_state
    );
  END IF;

  -- Already terminal: idempotent replay.
  IF v_row.outbox_state IN ('provider_accepted','send_failed','delivery_unknown') THEN
    RETURN jsonb_build_object(
      'ok', true, 'no_op', true, 'current_state', v_row.outbox_state
    );
  END IF;

  v_new_status := CASE p_new_state
    WHEN 'provider_accepted' THEN 'sent'::sms_status
    WHEN 'send_failed'       THEN 'failed'::sms_status
    ELSE v_row.status
  END;

  UPDATE public.sms_messages
     SET outbox_state = p_new_state,
         status = v_new_status,
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         provider_conversation_id = COALESCE(p_provider_conversation_id, provider_conversation_id),
         provider_status = COALESCE(p_provider_status, provider_status),
         provider_response_kind = COALESCE(p_provider_response_kind, provider_response_kind),
         provider_accepted_at = CASE WHEN p_new_state = 'provider_accepted' THEN now() ELSE provider_accepted_at END,
         provider_dispatched_at = COALESCE(provider_dispatched_at, now()),
         sent_at = CASE WHEN p_new_state = 'provider_accepted' THEN now() ELSE sent_at END,
         send_error_code = CASE WHEN p_new_state <> 'provider_accepted' THEN COALESCE(p_error, send_error_code) ELSE send_error_code END,
         send_error_at = CASE WHEN p_new_state <> 'provider_accepted' THEN now() ELSE send_error_at END,
         error = CASE WHEN p_new_state = 'send_failed' THEN COALESCE(p_error, error) ELSE error END,
         updated_at = now()
   WHERE id = p_sms_message_id;

  RETURN jsonb_build_object('ok', true, 'current_state', p_new_state);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_sms_outbox_send(uuid, uuid, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sms_outbox_send(uuid, uuid, text, text, text, text, text, text) TO service_role;
