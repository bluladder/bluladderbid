-- Launch delivery recovery: durable, server-authoritative quote email claims.
-- Additive only. This migration is repository-ready and must not be applied
-- without the separately authorized hosted migration window.

ALTER TABLE public.email_send_attempts
  ADD COLUMN IF NOT EXISTS semantic_key text,
  ADD COLUMN IF NOT EXISTS delivery_state text,
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_submission_at timestamptz,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS uncertainty_reason text;

REVOKE INSERT, UPDATE, DELETE ON public.email_send_attempts FROM authenticated;
DROP POLICY IF EXISTS "Admins can write email send attempts"
  ON public.email_send_attempts;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_attempts_semantic_key
  ON public.email_send_attempts (semantic_key)
  WHERE semantic_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_send_attempts_delivery_state
  ON public.email_send_attempts (delivery_state, claim_at)
  WHERE delivery_state IS NOT NULL;

ALTER TABLE public.email_send_attempts
  DROP CONSTRAINT IF EXISTS email_send_attempts_status_chk;
ALTER TABLE public.email_send_attempts
  ADD CONSTRAINT email_send_attempts_status_chk CHECK (status IN (
    'claimed','accepted','sent','delayed','delivered','bounced','complained',
    'failed','suppressed','uncertain'
  ));

ALTER TABLE public.email_send_attempts
  ADD CONSTRAINT email_send_attempts_delivery_state_chk CHECK (
    delivery_state IS NULL OR delivery_state IN (
      'claimed','provider_submission_pending','provider_accepted','delivered',
      'failed_retryable','failed_terminal','uncertain'
    )
  ) NOT VALID;
ALTER TABLE public.email_send_attempts
  VALIDATE CONSTRAINT email_send_attempts_delivery_state_chk;

CREATE OR REPLACE FUNCTION public.claim_quote_email_delivery(
  p_quote_id uuid,
  p_recipient_email text,
  p_claim_token uuid,
  p_template text DEFAULT 'save-quote',
  p_source_session_id text DEFAULT NULL,
  p_stale_claim_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_row public.email_send_attempts%ROWTYPE;
  v_semantic_key text;
  v_new_id uuid;
  v_stale boolean;
BEGIN
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_missing');
  END IF;
  IF v_quote.status NOT IN ('saved','emailed','viewed','pending')
     OR v_quote.superseded_by IS NOT NULL
     OR v_quote.converted_booking_id IS NOT NULL
     OR (v_quote.expires_at IS NOT NULL AND v_quote.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_not_deliverable');
  END IF;
  IF lower(btrim(COALESCE(v_quote.customer_email, '')))
     IS DISTINCT FROM lower(btrim(COALESCE(p_recipient_email, ''))) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'recipient_lineage_mismatch');
  END IF;

  v_semantic_key := 'quote_email:' || p_quote_id::text || ':' ||
    lower(btrim(p_recipient_email)) || ':' || md5(concat_ws(
      '|',
      COALESCE(v_quote.authoritative_snapshot::text, ''),
      COALESCE(v_quote.line_item_snapshot::text, ''),
      COALESCE(v_quote.total::text, '')
    ));

  INSERT INTO public.email_send_attempts (
    quote_id, template, recipient_email, provider, status, semantic_key,
    delivery_state, claim_token, claim_at, source_session_id, last_event_at,
    last_event_type
  ) VALUES (
    p_quote_id, p_template, lower(btrim(p_recipient_email)), 'resend',
    'claimed', v_semantic_key, 'provider_submission_pending', p_claim_token,
    now(), p_source_session_id, now(), 'claimed'
  )
  ON CONFLICT (semantic_key) WHERE semantic_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'id', v_new_id, 'is_new', true, 'may_dispatch', true,
      'delivery_state', 'provider_submission_pending',
      'semantic_key', v_semantic_key
    );
  END IF;

  SELECT * INTO v_row
  FROM public.email_send_attempts
  WHERE semantic_key = v_semantic_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_disappeared');
  END IF;

  IF v_row.delivery_state IN (
    'provider_accepted','delivered','failed_terminal','uncertain'
  ) OR v_row.status IN (
    'accepted','sent','delivered','bounced','complained','suppressed','uncertain'
  ) THEN
    RETURN jsonb_build_object(
      'ok', true, 'id', v_row.id, 'is_new', false, 'may_dispatch', false,
      'replay', true, 'delivery_state', v_row.delivery_state,
      'status', v_row.status, 'provider_message_id', v_row.provider_message_id,
      'failure_reason', v_row.failure_reason,
      'semantic_key', v_semantic_key
    );
  END IF;

  IF v_row.delivery_state IN ('claimed','provider_submission_pending') THEN
    v_stale := v_row.claim_at IS NULL OR
      now() - v_row.claim_at > make_interval(secs => p_stale_claim_seconds);
    IF NOT v_stale THEN
      RETURN jsonb_build_object(
        'ok', true, 'id', v_row.id, 'is_new', false,
        'may_dispatch', false, 'in_progress', true,
        'delivery_state', v_row.delivery_state,
        'semantic_key', v_semantic_key
      );
    END IF;

    UPDATE public.email_send_attempts
    SET delivery_state = 'uncertain', status = 'uncertain',
        uncertainty_reason = 'stale_provider_submission_claim',
        failure_reason = 'Provider submission outcome requires reconciliation',
        last_event_at = now(), last_event_type = 'claim_expired'
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'ok', true, 'id', v_row.id, 'is_new', false,
      'may_dispatch', false, 'replay', true, 'escalated', true,
      'delivery_state', 'uncertain', 'status', 'uncertain',
      'semantic_key', v_semantic_key
    );
  END IF;

  IF v_row.delivery_state = 'failed_retryable' THEN
    UPDATE public.email_send_attempts
    SET delivery_state = 'provider_submission_pending', status = 'claimed',
        claim_token = p_claim_token, claim_at = now(),
        last_event_at = now(), last_event_type = 'retry_claimed'
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'ok', true, 'id', v_row.id, 'is_new', false,
      'may_dispatch', true, 'delivery_state', 'provider_submission_pending',
      'semantic_key', v_semantic_key
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'id', v_row.id, 'is_new', false,
    'may_dispatch', false, 'replay', true,
    'delivery_state', v_row.delivery_state, 'status', v_row.status,
    'semantic_key', v_semantic_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_quote_email_delivery(uuid, text, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quote_email_delivery(uuid, text, uuid, text, text, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_quote_email_delivery(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_delivery_state text,
  p_provider_message_id text,
  p_failure_category text,
  p_failure_reason text,
  p_http_status integer,
  p_metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.email_send_attempts%ROWTYPE;
  v_status text;
BEGIN
  IF p_delivery_state NOT IN (
    'provider_accepted','failed_retryable','failed_terminal','uncertain'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_delivery_state');
  END IF;

  SELECT * INTO v_row
  FROM public.email_send_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'attempt_missing');
  END IF;
  IF v_row.claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'claim_token_mismatch',
      'current_state', v_row.delivery_state
    );
  END IF;
  IF v_row.delivery_state IN ('provider_accepted','delivered','failed_terminal','uncertain') THEN
    RETURN jsonb_build_object(
      'ok', true, 'no_op', true, 'current_state', v_row.delivery_state
    );
  END IF;

  v_status := CASE p_delivery_state
    WHEN 'provider_accepted' THEN 'accepted'
    WHEN 'uncertain' THEN 'uncertain'
    ELSE 'failed'
  END;

  UPDATE public.email_send_attempts
  SET delivery_state = p_delivery_state,
      status = v_status,
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      provider_submission_at = COALESCE(provider_submission_at, now()),
      submitted_at = COALESCE(submitted_at, now()),
      accepted_at = CASE WHEN p_delivery_state = 'provider_accepted'
        THEN now() ELSE accepted_at END,
      failure_category = p_failure_category,
      failure_reason = p_failure_reason,
      uncertainty_reason = CASE WHEN p_delivery_state = 'uncertain'
        THEN COALESCE(p_failure_reason, 'provider_result_uncertain') ELSE NULL END,
      http_status = p_http_status,
      metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE(p_metadata, '{}'::jsonb),
      last_event_at = now(),
      last_event_type = p_delivery_state
  WHERE id = p_attempt_id;

  RETURN jsonb_build_object('ok', true, 'current_state', p_delivery_state);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_quote_email_delivery(uuid, uuid, text, text, text, text, integer, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_quote_email_delivery(uuid, uuid, text, text, text, text, integer, jsonb)
  TO service_role;

-- Quote-specific wrapper around the existing SMS outbox. It validates the
-- quote lifecycle and binds quote lineage in the same transaction as the
-- durable provider-dispatch claim.
CREATE OR REPLACE FUNCTION public.claim_quote_sms_delivery(
  p_quote_id uuid,
  p_outbound_key text,
  p_claim_token uuid,
  p_to_number text,
  p_body text,
  p_message_kind text,
  p_stale_claim_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_expected_key text;
  v_claim jsonb;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id FOR SHARE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_missing');
  END IF;
  IF v_quote.status NOT IN ('saved','emailed','viewed','pending')
     OR v_quote.superseded_by IS NOT NULL
     OR v_quote.converted_booking_id IS NOT NULL
     OR (v_quote.expires_at IS NOT NULL AND v_quote.expires_at <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_not_deliverable');
  END IF;

  v_expected_key := 'quote_delivery:sms:' || p_quote_id::text || ':' ||
    regexp_replace(COALESCE(p_to_number, ''), '[^0-9]', '', 'g');
  IF p_outbound_key IS DISTINCT FROM v_expected_key THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'semantic_key_mismatch');
  END IF;

  v_claim := public.claim_sms_outbox_send(
    p_outbound_key, p_claim_token, p_to_number, p_body, p_message_kind,
    p_stale_claim_seconds
  );
  IF COALESCE((v_claim->>'ok')::boolean, false) AND v_claim ? 'id' THEN
    UPDATE public.sms_messages
      SET quote_id = COALESCE(quote_id, p_quote_id)
      WHERE id = (v_claim->>'id')::uuid
        AND (quote_id IS NULL OR quote_id = p_quote_id);
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'quote_lineage_conflict');
    END IF;
  END IF;
  RETURN v_claim;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_quote_sms_delivery(uuid, text, uuid, text, text, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_quote_sms_delivery(uuid, text, uuid, text, text, text, integer)
  TO service_role;

ALTER TABLE public.resend_webhook_events
  ADD COLUMN IF NOT EXISTS processing_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS processing_claim_token uuid,
  ADD COLUMN IF NOT EXISTS processing_claim_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_error text;

ALTER TABLE public.resend_webhook_events
  ADD CONSTRAINT resend_webhook_events_processing_state_chk CHECK (
    processing_state IN ('pending','processing','processed','failed')
  ) NOT VALID;
ALTER TABLE public.resend_webhook_events
  VALIDATE CONSTRAINT resend_webhook_events_processing_state_chk;

CREATE OR REPLACE FUNCTION public.claim_resend_webhook_event(
  p_svix_id text,
  p_event_type text,
  p_provider_message_id text,
  p_payload jsonb,
  p_claim_token uuid,
  p_stale_claim_seconds integer DEFAULT 120
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.resend_webhook_events%ROWTYPE;
  v_new_id uuid;
BEGIN
  INSERT INTO public.resend_webhook_events (
    svix_id, event_type, provider_message_id, payload,
    processing_state, processing_claim_token, processing_claim_at
  ) VALUES (
    p_svix_id, p_event_type, p_provider_message_id, p_payload,
    'processing', p_claim_token, now()
  )
  ON CONFLICT (svix_id) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'id', v_new_id, 'may_process', true, 'is_new', true
    );
  END IF;

  SELECT * INTO v_row FROM public.resend_webhook_events
  WHERE svix_id = p_svix_id FOR UPDATE;
  IF v_row.processing_state = 'processed' THEN
    RETURN jsonb_build_object(
      'ok', true, 'id', v_row.id, 'may_process', false, 'replay', true
    );
  END IF;
  IF v_row.processing_state = 'processing'
     AND v_row.processing_claim_at IS NOT NULL
     AND now() - v_row.processing_claim_at <=
       make_interval(secs => p_stale_claim_seconds) THEN
    RETURN jsonb_build_object(
      'ok', true, 'id', v_row.id, 'may_process', false, 'in_progress', true
    );
  END IF;

  UPDATE public.resend_webhook_events
  SET processing_state = 'processing',
      processing_claim_token = p_claim_token,
      processing_claim_at = now(),
      processing_error = NULL
  WHERE id = v_row.id;
  RETURN jsonb_build_object(
    'ok', true, 'id', v_row.id, 'may_process', true, 'is_new', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_resend_webhook_event(
  p_event_id uuid,
  p_claim_token uuid,
  p_success boolean,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.resend_webhook_events%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.resend_webhook_events
  WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'event_missing');
  END IF;
  IF v_row.processing_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'claim_token_mismatch');
  END IF;
  UPDATE public.resend_webhook_events
  SET processing_state = CASE WHEN p_success THEN 'processed' ELSE 'failed' END,
      processed_at = CASE WHEN p_success THEN now() ELSE processed_at END,
      processing_error = CASE WHEN p_success THEN NULL ELSE p_error END
  WHERE id = p_event_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_resend_webhook_event(text, text, text, jsonb, uuid, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_resend_webhook_event(uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_resend_webhook_event(text, text, text, jsonb, uuid, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_resend_webhook_event(uuid, uuid, boolean, text)
  TO service_role;

-- The generic retry queue must never reclaim or dispatch an outbox-owned row.
-- Outbox uncertainty is reconciled explicitly; changing it back to pending
-- would recreate the provider-accepted crash duplication window.
CREATE OR REPLACE FUNCTION public.claim_due_sms(p_limit integer DEFAULT 50)
RETURNS SETOF public.sms_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.sms_messages
    SET status = 'pending', updated_at = now()
    WHERE status = 'processing'
      AND outbox_state IS NULL
      AND updated_at < now() - interval '10 minutes';

  RETURN QUERY
  UPDATE public.sms_messages m
    SET status = 'processing', updated_at = now()
    WHERE m.id IN (
      SELECT id FROM public.sms_messages
      WHERE status = 'pending'
        AND outbox_state IS NULL
        AND send_at <= now()
      ORDER BY send_at ASC
      LIMIT GREATEST(p_limit, 1)
      FOR UPDATE SKIP LOCKED
    )
    RETURNING m.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_sms(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_sms(integer) TO service_role;
