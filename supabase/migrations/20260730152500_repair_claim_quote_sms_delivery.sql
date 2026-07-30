-- Repair missing hosted quote-SMS claim wrapper.
--
-- The canonical definition originally shipped in
-- 20260729231424_launch_delivery_recovery.sql, but that repository-only
-- migration was not applied to the hosted database before send-sms adopted
-- the RPC. This narrowly scoped, idempotent repair installs only the missing
-- wrapper and its execution grants.

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
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quote_missing');
  END IF;

  IF v_quote.status NOT IN ('saved', 'emailed', 'viewed', 'pending')
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
    p_outbound_key,
    p_claim_token,
    p_to_number,
    p_body,
    p_message_kind,
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

REVOKE ALL ON FUNCTION public.claim_quote_sms_delivery(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_quote_sms_delivery(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) TO service_role;
