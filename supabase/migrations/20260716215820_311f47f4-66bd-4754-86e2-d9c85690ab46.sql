
-- 1) Jobber OAuth CSRF state
CREATE TABLE IF NOT EXISTS public.jobber_oauth_states (
  state TEXT PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  consumed_at TIMESTAMPTZ
);
GRANT ALL ON public.jobber_oauth_states TO service_role;
ALTER TABLE public.jobber_oauth_states ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (edge functions) touches this table.

-- 2) availability_cache: remove public read; service_role bypasses RLS
DROP POLICY IF EXISTS "Public can read non-expired cache" ON public.availability_cache;

-- 3) customer_verification_config: restrict SELECT to admins
DROP POLICY IF EXISTS "Anyone authenticated can view verification config" ON public.customer_verification_config;
CREATE POLICY "Admins can view verification config"
  ON public.customer_verification_config
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- 4) eligibility_rules: hide internal tech IDs from public via view
DROP POLICY IF EXISTS "Public can view active rules" ON public.eligibility_rules;
CREATE POLICY "Admins can view all rules"
  ON public.eligibility_rules
  FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE VIEW public.eligibility_rules_public
WITH (security_invoker = false) AS
SELECT id, rule_name, priority, conditions, rule_type, is_active, description, created_at, updated_at
FROM public.eligibility_rules
WHERE is_active = true;

GRANT SELECT ON public.eligibility_rules_public TO anon, authenticated;

-- 5) Revoke anon EXECUTE from SECURITY DEFINER test helpers
REVOKE EXECUTE ON FUNCTION public.authorize_customer_access_test(text,text,text,text,integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.consume_customer_access_test_auth(text,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_customer_access_test_booking_fixture() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_customer_access_test_result(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.authorize_customer_access_test(text,text,text,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_customer_access_test_auth(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer_access_test_booking_fixture() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_customer_access_test_result(uuid,jsonb) TO authenticated;
