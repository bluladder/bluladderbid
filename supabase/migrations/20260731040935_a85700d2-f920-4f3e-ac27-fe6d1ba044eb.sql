CREATE OR REPLACE FUNCTION public.claim_sms_outbox_send(p_outbound_key text, p_claim_token uuid, p_to_number text, p_body text, p_message_kind text, p_stale_claim_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Must mirror the PARTIAL unique index
  -- uq_sms_messages_outbound_idempotency_key ... WHERE outbound_idempotency_key IS NOT NULL,
  -- otherwise Postgres raises "no unique or exclusion constraint matching the
  -- ON CONFLICT specification" and every outbox claim fails.
  ON CONFLICT (outbound_idempotency_key) WHERE outbound_idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.sms_messages WHERE id = v_new_id;
    RETURN jsonb_build_object(
      'ok', true, 'is_new', true, 'id', v_row.id,
      'outbox_state', v_row.outbox_state, 'may_dispatch', true
    );
  END IF;

  SELECT * INTO v_row FROM public.sms_messages
   WHERE outbound_idempotency_key = p_outbound_key
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'row_disappeared');
  END IF;

  IF v_row.outbox_state IN ('provider_accepted','send_failed','delivery_unknown')
     OR v_row.status IN ('sent','failed') THEN
    RETURN jsonb_build_object(
      'ok', true, 'is_new', false, 'id', v_row.id,
      'outbox_state', v_row.outbox_state, 'status', v_row.status,
      'may_dispatch', false, 'replay', true,
      'provider_message_id', v_row.provider_message_id
    );
  END IF;

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
$function$;