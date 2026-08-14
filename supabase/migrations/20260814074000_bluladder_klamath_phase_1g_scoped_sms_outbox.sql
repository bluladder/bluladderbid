-- Phase 1G transactional outbox organization/connector authority.
--
-- Adds one new claim boundary. Existing claim functions remain unchanged so
-- this migration cannot silently alter deployed DFW behavior. New runtime may
-- dispatch only after one active organization-owned SMS connector is resolved.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  public.organizations,
  public.organization_messaging_connectors,
  public.quotes,
  public.sms_messages
IN SHARE ROW EXCLUSIVE MODE;

DO $phase1g_scoped_outbox_preflight$
BEGIN
  IF to_regclass('public.organization_messaging_connectors') IS NULL
     OR to_regclass('public.sms_messages') IS NULL
     OR to_regclass('public.quotes') IS NULL THEN
    RAISE EXCEPTION 'Phase 1G scoped outbox prerequisite is missing';
  END IF;
  IF to_regprocedure(
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'Phase 1G scoped outbox claim already exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_messaging_connectors)
     OR (SELECT count(*) FROM public.sms_messages) <> 134
     OR EXISTS (
       SELECT 1 FROM public.sms_messages
       WHERE organization_id IS NULL
          OR organization_id <>
            'b1addf00-0000-4000-8000-000000000001'::uuid
          OR messaging_connector_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Phase 1G reviewed hosted lineage state changed';
  END IF;
  IF (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE slug = 'bluladder-klamath' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Phase 1G Klamath inactive boundary changed';
  END IF;
END
$phase1g_scoped_outbox_preflight$;

CREATE FUNCTION public.claim_organization_sms_outbox_send(
  p_organization_id uuid,
  p_messaging_connector_id uuid,
  p_outbound_key text,
  p_claim_token uuid,
  p_to_number text,
  p_body text,
  p_message_kind text,
  p_quote_id uuid DEFAULT NULL,
  p_stale_claim_seconds integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_connector public.organization_messaging_connectors%ROWTYPE;
  v_organization_status text;
  v_quote_organization_id uuid;
  v_row public.sms_messages%ROWTYPE;
  v_new_id uuid;
  v_stale boolean;
BEGIN
  IF p_organization_id IS NULL OR p_messaging_connector_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'organization_authority_missing'
    );
  END IF;
  IF p_outbound_key IS NULL OR btrim(p_outbound_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_outbound_key');
  END IF;

  SELECT status INTO v_organization_status
  FROM public.organizations
  WHERE id = p_organization_id;
  IF v_organization_status IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'organization_inactive'
    );
  END IF;

  SELECT * INTO v_connector
  FROM public.organization_messaging_connectors
  WHERE id = p_messaging_connector_id
  FOR SHARE;
  IF NOT FOUND
     OR v_connector.organization_id <> p_organization_id
     OR v_connector.channel <> 'sms'
     OR v_connector.status <> 'active'
     OR v_connector.credential_reference IS NULL
     OR btrim(v_connector.credential_reference) = ''
     OR v_connector.sender_identity_reference IS NULL
     OR btrim(v_connector.sender_identity_reference) = '' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'connector_authority_invalid'
    );
  END IF;

  IF p_quote_id IS NOT NULL THEN
    SELECT organization_id INTO v_quote_organization_id
    FROM public.quotes
    WHERE id = p_quote_id;
    IF v_quote_organization_id IS NULL
       OR v_quote_organization_id <> p_organization_id THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'quote_organization_mismatch'
      );
    END IF;
  END IF;

  INSERT INTO public.sms_messages (
    organization_id,
    messaging_connector_id,
    quote_id,
    to_number,
    channel,
    body,
    message_kind,
    status,
    outbound_idempotency_key,
    outbox_state,
    send_claim_token,
    send_claim_at
  ) VALUES (
    p_organization_id,
    p_messaging_connector_id,
    p_quote_id,
    p_to_number,
    'sms',
    p_body,
    p_message_kind,
    'processing'::sms_status,
    p_outbound_key,
    'sending',
    p_claim_token,
    now()
  )
  ON CONFLICT (outbound_idempotency_key)
    WHERE outbound_idempotency_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.sms_messages WHERE id = v_new_id;
    RETURN jsonb_build_object(
      'ok', true,
      'is_new', true,
      'id', v_row.id,
      'outbox_state', v_row.outbox_state,
      'may_dispatch', true,
      'provider', v_connector.provider
    );
  END IF;

  SELECT * INTO v_row
  FROM public.sms_messages
  WHERE outbound_idempotency_key = p_outbound_key
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'row_disappeared');
  END IF;
  IF v_row.organization_id IS DISTINCT FROM p_organization_id
     OR v_row.messaging_connector_id IS DISTINCT FROM p_messaging_connector_id
     OR v_row.quote_id IS DISTINCT FROM p_quote_id THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'organization_lineage_mismatch'
    );
  END IF;

  IF v_row.outbox_state IN (
    'provider_accepted', 'send_failed', 'delivery_unknown'
  ) OR v_row.status IN ('sent', 'failed') THEN
    RETURN jsonb_build_object(
      'ok', true,
      'is_new', false,
      'id', v_row.id,
      'outbox_state', v_row.outbox_state,
      'status', v_row.status,
      'may_dispatch', false,
      'replay', true,
      'provider_message_id', v_row.provider_message_id,
      'provider', v_connector.provider
    );
  END IF;

  IF v_row.outbox_state = 'sending' THEN
    v_stale := v_row.send_claim_at IS NULL OR (
      now() - v_row.send_claim_at >
        make_interval(secs => greatest(p_stale_claim_seconds, 1))
    );
    IF NOT v_stale THEN
      RETURN jsonb_build_object(
        'ok', true,
        'is_new', false,
        'id', v_row.id,
        'outbox_state', v_row.outbox_state,
        'may_dispatch', false,
        'in_progress', true,
        'provider', v_connector.provider
      );
    END IF;
    UPDATE public.sms_messages
    SET outbox_state = 'delivery_unknown',
        send_error_code = 'stale_claim_escalated',
        send_error_at = now(),
        updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'ok', true,
      'is_new', false,
      'id', v_row.id,
      'outbox_state', 'delivery_unknown',
      'may_dispatch', false,
      'escalated', true,
      'provider', v_connector.provider
    );
  END IF;

  UPDATE public.sms_messages
  SET outbox_state = 'sending',
      send_claim_token = p_claim_token,
      send_claim_at = now(),
      updated_at = now()
  WHERE id = v_row.id;
  RETURN jsonb_build_object(
    'ok', true,
    'is_new', false,
    'id', v_row.id,
    'outbox_state', 'sending',
    'may_dispatch', true,
    'provider', v_connector.provider
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_organization_sms_outbox_send(
  uuid, uuid, text, uuid, text, text, text, uuid, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_organization_sms_outbox_send(
  uuid, uuid, text, uuid, text, text, text, uuid, integer
) TO service_role;

DO $phase1g_scoped_outbox_postflight$
BEGIN
  IF to_regprocedure(
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'Phase 1G scoped outbox claim was not created';
  END IF;
  IF has_function_privilege(
    'anon',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'service_role',
    'public.claim_organization_sms_outbox_send(uuid,uuid,text,uuid,text,text,text,uuid,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 1G scoped outbox execution grants are not exact';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_messaging_connectors)
     OR (SELECT count(*) FROM public.sms_messages) <> 134
     OR EXISTS (
       SELECT 1 FROM public.sms_messages
       WHERE organization_id IS NULL
          OR organization_id <>
            'b1addf00-0000-4000-8000-000000000001'::uuid
          OR messaging_connector_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Phase 1G scoped outbox migration changed data';
  END IF;
END
$phase1g_scoped_outbox_postflight$;

COMMIT;
