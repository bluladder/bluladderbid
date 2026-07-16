
-- 1) Authorization ledger for the three Customer Access live tests
CREATE TABLE IF NOT EXISTS public.customer_access_test_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_type text NOT NULL CHECK (test_type IN ('sms_otp','email_otp','booking_link_sms')),
  recipient text NOT NULL,
  target_id text,
  idempotency_key text NOT NULL,
  authorized_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (test_type, idempotency_key)
);

GRANT ALL ON public.customer_access_test_authorizations TO service_role;
-- No grants for anon / authenticated: access flows exclusively through SECURITY DEFINER RPCs.

ALTER TABLE public.customer_access_test_authorizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cat_auth_admin_select" ON public.customer_access_test_authorizations
  FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'));

-- 2) is_test_fixture flag on bookings (admin-only synthetic rows)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS is_test_fixture boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS bookings_is_test_fixture_idx
  ON public.bookings(is_test_fixture) WHERE is_test_fixture = true;

-- 3) Authorize a single-scope, single-use test override
CREATE OR REPLACE FUNCTION public.authorize_customer_access_test(
  p_test_type text,
  p_recipient text,
  p_target_id text,
  p_idempotency_key text,
  p_ttl_minutes integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.customer_access_test_authorizations%ROWTYPE;
  v_ttl integer := LEAST(GREATEST(COALESCE(p_ttl_minutes, 15), 5), 30);
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_test_type NOT IN ('sms_otp','email_otp','booking_link_sms') THEN
    RAISE EXCEPTION 'invalid test_type';
  END IF;
  IF coalesce(trim(p_recipient),'') = '' OR coalesce(trim(p_idempotency_key),'') = '' THEN
    RAISE EXCEPTION 'recipient and idempotency key required';
  END IF;

  INSERT INTO public.customer_access_test_authorizations (
    test_type, recipient, target_id, idempotency_key,
    authorized_by, expires_at
  ) VALUES (
    p_test_type, p_recipient, p_target_id, p_idempotency_key,
    auth.uid(), now() + make_interval(mins => v_ttl)
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'correlation_id', v_row.correlation_id,
    'test_type', v_row.test_type,
    'expires_at', v_row.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_customer_access_test(text,text,text,text,integer) FROM public;
GRANT EXECUTE ON FUNCTION public.authorize_customer_access_test(text,text,text,text,integer) TO authenticated;

-- 4) Consume an authorization exactly once, scoped to one test_type
CREATE OR REPLACE FUNCTION public.consume_customer_access_test_auth(
  p_test_type text,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.customer_access_test_authorizations%ROWTYPE;
BEGIN
  UPDATE public.customer_access_test_authorizations
     SET consumed_at = now()
   WHERE id = (
     SELECT id FROM public.customer_access_test_authorizations
      WHERE test_type = p_test_type
        AND idempotency_key = p_idempotency_key
        AND consumed_at IS NULL
        AND expires_at > now()
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
   RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('status','denied');
  END IF;

  RETURN jsonb_build_object(
    'status','authorized',
    'id', v_row.id,
    'correlation_id', v_row.correlation_id,
    'recipient', v_row.recipient,
    'target_id', v_row.target_id,
    'authorized_by', v_row.authorized_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.consume_customer_access_test_auth(text,text) FROM public;
GRANT EXECUTE ON FUNCTION public.consume_customer_access_test_auth(text,text) TO service_role;

-- 5) Record final send result on the authorization
CREATE OR REPLACE FUNCTION public.record_customer_access_test_result(
  p_id uuid, p_result jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.customer_access_test_authorizations
     SET result_json = p_result
   WHERE id = p_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_customer_access_test_result(uuid,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.record_customer_access_test_result(uuid,jsonb) TO service_role;

-- 6) Admin-only synthetic booking fixture tied to the protected test identity
CREATE OR REPLACE FUNCTION public.create_customer_access_test_booking_fixture()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid;
  v_booking_id uuid;
  v_start timestamptz := date_trunc('day', now()) + interval '365 days' + interval '10 hours';
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_admin_level(auth.uid(), 'operations_admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Reuse an existing fixture if one is present.
  SELECT id INTO v_booking_id FROM public.bookings
    WHERE is_test_fixture = true
    ORDER BY created_at DESC LIMIT 1;
  IF v_booking_id IS NOT NULL THEN
    RETURN v_booking_id;
  END IF;

  -- Look up (do NOT create) the protected test-identity customer if one exists.
  SELECT c.id INTO v_customer_id
    FROM public.customers c
    JOIN public.test_identities t
      ON lower(coalesce(c.email,'')) = lower(t.email)
   WHERE t.protected = true AND t.active = true
   ORDER BY c.created_at DESC LIMIT 1;

  INSERT INTO public.bookings (
    customer_id, reference_number, scheduled_start, scheduled_end,
    address, status, services_json, total, is_test_fixture
  ) VALUES (
    v_customer_id,
    public.generate_booking_reference(),
    v_start,
    v_start + interval '2 hours',
    'Admin test fixture — not a real appointment',
    'test_fixture',
    '[]'::jsonb,
    0,
    true
  ) RETURNING id INTO v_booking_id;

  RETURN v_booking_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_customer_access_test_booking_fixture() FROM public;
GRANT EXECUTE ON FUNCTION public.create_customer_access_test_booking_fixture() TO authenticated;
