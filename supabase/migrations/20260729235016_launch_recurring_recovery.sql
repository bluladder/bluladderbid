-- Launch recurring-delivery recovery.
--
-- Every ordinary queued communication is claimed before a provider call. A
-- stale pre-submission claim is safe to release; a stale `sending` claim is
-- never re-dispatched because the provider may already have accepted it.
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS delivery_reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_reconciliation_reason text;

CREATE OR REPLACE FUNCTION public.claim_due_sms(p_limit integer DEFAULT 50)
RETURNS SETOF public.sms_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Rows abandoned before the explicit provider boundary are safe to retry.
  UPDATE public.sms_messages
     SET status = 'pending',
         outbox_state = NULL,
         send_claim_token = NULL,
         send_claim_at = NULL,
         error = 'Recovered stale pre-submission queue claim',
         updated_at = now()
   WHERE status = 'processing'
     AND outbox_state = 'pending_send'
     AND send_claim_at < now() - interval '10 minutes';

  -- Legacy workers had no provider-boundary state. A stale legacy processing
  -- row might already have crossed the provider boundary, so fail closed.
  UPDATE public.sms_messages
     SET outbox_state = 'delivery_unknown',
         send_error_code = 'legacy_stale_queue_claim_provider_result_unknown',
         send_error_at = now(),
         error = 'Provider result uncertain after legacy queue claim',
         updated_at = now()
   WHERE status = 'processing'
     AND outbox_state IS NULL
     AND updated_at < now() - interval '10 minutes';

  UPDATE public.sms_messages
     SET outbox_state = 'delivery_unknown',
         send_error_code = 'stale_queue_claim_provider_result_unknown',
         send_error_at = now(),
         error = 'Provider result uncertain after stale queue claim',
         updated_at = now()
   WHERE status = 'processing'
     AND outbox_state = 'sending'
     AND send_claim_at < now() - interval '10 minutes';

  RETURN QUERY
  UPDATE public.sms_messages m
     SET status = 'processing',
         outbound_idempotency_key = COALESCE(
           m.outbound_idempotency_key,
           'queue:' || m.id::text
         ),
         outbox_state = 'pending_send',
         send_claim_token = gen_random_uuid(),
         send_claim_at = now(),
         send_error_code = NULL,
         send_error_at = NULL,
         updated_at = now()
   WHERE m.id IN (
     SELECT id
       FROM public.sms_messages
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

-- Establish the provider-submission boundary. Only the current claim owner may
-- cross it, and a duplicate/lost-response begin never authorizes a second call.
CREATE OR REPLACE FUNCTION public.begin_queued_communication_submission(
  p_sms_message_id uuid,
  p_claim_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.sms_messages
   WHERE id = p_sms_message_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'row_missing');
  END IF;
  IF v_row.send_claim_token IS DISTINCT FROM p_claim_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'claim_token_mismatch');
  END IF;
  IF v_row.outbox_state = 'sending' THEN
    RETURN jsonb_build_object(
      'ok', true, 'may_dispatch', false, 'reason', 'submission_already_begun'
    );
  END IF;
  IF v_row.status <> 'processing' OR v_row.outbox_state <> 'pending_send' THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'invalid_submission_state',
      'state', v_row.outbox_state
    );
  END IF;

  UPDATE public.sms_messages
     SET outbox_state = 'sending',
         provider_dispatched_at = now(),
         updated_at = now()
   WHERE id = p_sms_message_id;

  RETURN jsonb_build_object('ok', true, 'may_dispatch', true);
END;
$$;

REVOKE ALL ON FUNCTION public.begin_queued_communication_submission(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_queued_communication_submission(uuid, uuid)
  TO service_role;

-- Explicit, service-only reconciliation. Unknown work never retries unless
-- provider evidence proves it was not sent; acceptance requires a provider ID.
CREATE OR REPLACE FUNCTION public.reconcile_queued_communication_delivery(
  p_sms_message_id uuid,
  p_outcome text,
  p_provider_message_id text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_messages%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('provider_accepted', 'confirmed_not_sent')
     OR COALESCE(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_evidence');
  END IF;

  SELECT * INTO v_row
    FROM public.sms_messages
   WHERE id = p_sms_message_id
   FOR UPDATE;
  IF NOT FOUND OR v_row.outbox_state <> 'delivery_unknown' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_delivery_unknown');
  END IF;
  IF p_outcome = 'provider_accepted'
     AND COALESCE(btrim(p_provider_message_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'provider_id_required');
  END IF;

  UPDATE public.sms_messages
     SET status = CASE
           WHEN p_outcome = 'provider_accepted' THEN 'accepted'::sms_status
           ELSE 'pending'::sms_status
         END,
         outbox_state = CASE
           WHEN p_outcome = 'provider_accepted' THEN 'provider_accepted'
           ELSE NULL
         END,
         provider_message_id = COALESCE(
           NULLIF(btrim(p_provider_message_id), ''),
           provider_message_id
         ),
         provider_accepted_at = CASE
           WHEN p_outcome = 'provider_accepted' THEN now()
           ELSE provider_accepted_at
         END,
         sent_at = CASE
           WHEN p_outcome = 'provider_accepted' THEN now()
           ELSE sent_at
         END,
         send_claim_token = NULL,
         send_claim_at = NULL,
         delivery_reconciled_at = now(),
         delivery_reconciliation_reason = btrim(p_reason),
         error = CASE
           WHEN p_outcome = 'provider_accepted' THEN NULL
           ELSE 'Provider evidence confirmed message was not sent'
         END,
         updated_at = now()
   WHERE id = p_sms_message_id;

  RETURN jsonb_build_object('ok', true, 'outcome', p_outcome);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_queued_communication_delivery(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_queued_communication_delivery(uuid, text, text, text)
  TO service_role;
