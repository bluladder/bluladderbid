-- ============================================================================
-- One-time, strictly-scoped live Jobber booking authorization for the approved
-- protected test identity. Additive only. No general "bypass" switch. Message
-- suppression is unaffected (it lives at the delivery layer).
-- ============================================================================

ALTER TABLE public.test_identities
  ADD COLUMN IF NOT EXISTS live_jobber_test_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS authorized_conversation_id uuid,
  ADD COLUMN IF NOT EXISTS authorized_idempotency_key text,
  ADD COLUMN IF NOT EXISTS authorized_slot_id text,
  ADD COLUMN IF NOT EXISTS authorization_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorization_consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorized_by uuid,
  ADD COLUMN IF NOT EXISTS authorized_result jsonb;

-- ---------------------------------------------------------------------------
-- authorize_live_jobber_test — an authenticated operations admin issues ONE
-- authorization, always against the approved protected+active test identity.
-- Auto-expires in ~20 minutes. Resets consumed/result so it is single-use.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.authorize_live_jobber_test(
  p_email text,
  p_conversation_id uuid,
  p_slot_id text,
  p_idempotency_key text,
  p_ttl_minutes integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_expires timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_conversation_id IS NULL OR coalesce(trim(p_slot_id), '') = '' OR coalesce(trim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'conversation, slot and idempotency key are required';
  END IF;

  v_expires := now() + make_interval(mins => least(greatest(coalesce(p_ttl_minutes, 20), 15), 30));

  UPDATE public.test_identities
     SET live_jobber_test_enabled   = true,
         authorized_conversation_id = p_conversation_id,
         authorized_slot_id         = p_slot_id,
         authorized_idempotency_key = p_idempotency_key,
         authorization_expires_at   = v_expires,
         authorization_consumed_at  = NULL,
         authorized_result          = NULL,
         authorized_by              = auth.uid()
   WHERE lower(email) = lower(p_email)
     AND protected = true
     AND active = true
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no protected active test identity found for %', p_email;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'expires_at', v_expires, 'authorized_by', auth.uid());
END;
$$;

-- ---------------------------------------------------------------------------
-- consume_live_jobber_authorization — called by the booking edge function
-- (service role). Atomically permits EXACTLY ONE live write for the exact
-- authorized conversation + slot + idempotency key. Returns:
--   authorized        -> first consume; do the live write
--   already_consumed  -> same key again; live path replays original result
--   denied/expired/mismatch -> caller must simulate (no live write)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_live_jobber_authorization(
  p_email text,
  p_conversation_id uuid,
  p_slot_id text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.test_identities%ROWTYPE;
BEGIN
  SELECT * INTO rec
    FROM public.test_identities
   WHERE lower(email) = lower(p_email)
     AND protected = true
     AND active = true
   FOR UPDATE;

  IF NOT FOUND OR rec.live_jobber_test_enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('status', 'denied');
  END IF;
  IF rec.authorization_expires_at IS NULL OR rec.authorization_expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF rec.authorized_conversation_id IS DISTINCT FROM p_conversation_id
     OR rec.authorized_slot_id IS DISTINCT FROM p_slot_id
     OR rec.authorized_idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;

  IF rec.authorization_consumed_at IS NOT NULL THEN
    -- Same authorized key used again: allow the idempotent replay path.
    RETURN jsonb_build_object('status', 'already_consumed', 'result', rec.authorized_result);
  END IF;

  UPDATE public.test_identities
     SET authorization_consumed_at = now()
   WHERE id = rec.id;

  RETURN jsonb_build_object('status', 'authorized');
END;
$$;

-- Store the original booking result for auditable replay (service role only).
CREATE OR REPLACE FUNCTION public.record_live_jobber_authorization_result(
  p_email text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.test_identities
     SET authorized_result = p_result
   WHERE lower(email) = lower(p_email)
     AND protected = true
     AND active = true
     AND live_jobber_test_enabled = true
     AND authorized_result IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- clear_live_jobber_authorization — admin revokes/clears after the test.
-- Preserves the identity itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clear_live_jobber_authorization(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.test_identities
     SET live_jobber_test_enabled   = false,
         authorized_conversation_id = NULL,
         authorized_slot_id         = NULL,
         authorized_idempotency_key = NULL,
         authorization_expires_at   = NULL,
         authorization_consumed_at  = NULL,
         authorized_result          = NULL,
         authorized_by              = NULL
   WHERE lower(email) = lower(p_email)
     AND protected = true;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_live_jobber_test(text, uuid, text, text, integer) FROM public, anon;
REVOKE ALL ON FUNCTION public.consume_live_jobber_authorization(text, uuid, text, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_live_jobber_authorization_result(text, jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.clear_live_jobber_authorization(text) FROM public, anon;

GRANT EXECUTE ON FUNCTION public.authorize_live_jobber_test(text, uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_live_jobber_authorization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_live_jobber_authorization(text, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_live_jobber_authorization_result(text, jsonb) TO service_role;