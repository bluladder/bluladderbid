
-- 1. customer_accounts: verified-phone → internal customer mapping
CREATE TABLE public.customer_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  verified_phone text NOT NULL UNIQUE,
  last_verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.customer_accounts TO service_role;
ALTER TABLE public.customer_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view customer accounts" ON public.customer_accounts
  FOR SELECT TO authenticated USING (public.is_admin() OR public.has_admin_level(auth.uid(),'read_only_admin'));

-- 2. customer_verification_challenges
CREATE TABLE public.customer_verification_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','expired','locked','cancelled')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  ip_hash text,
  callrail_message_id text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  delivery_status text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cvc_phone_hash_created ON public.customer_verification_challenges(phone_hash, created_at DESC);
CREATE INDEX ix_cvc_ip_hash_created ON public.customer_verification_challenges(ip_hash, created_at DESC);
GRANT ALL ON public.customer_verification_challenges TO service_role;
ALTER TABLE public.customer_verification_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view verification challenges" ON public.customer_verification_challenges
  FOR SELECT TO authenticated USING (public.is_admin() OR public.has_admin_level(auth.uid(),'read_only_admin'));

-- 3. customer_portal_sessions
CREATE TABLE public.customer_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token_hash text NOT NULL UNIQUE,
  customer_account_id uuid NOT NULL REFERENCES public.customer_accounts(id) ON DELETE CASCADE,
  ip_hash text,
  user_agent_hash text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_cps_account ON public.customer_portal_sessions(customer_account_id);
GRANT ALL ON public.customer_portal_sessions TO service_role;
ALTER TABLE public.customer_portal_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view portal sessions" ON public.customer_portal_sessions
  FOR SELECT TO authenticated USING (public.is_admin() OR public.has_admin_level(auth.uid(),'read_only_admin'));

-- 4. booking_management_tokens
CREATE TABLE public.booking_management_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  use_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_bmt_booking ON public.booking_management_tokens(booking_id);
GRANT ALL ON public.booking_management_tokens TO service_role;
ALTER TABLE public.booking_management_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view booking management tokens" ON public.booking_management_tokens
  FOR SELECT TO authenticated USING (public.is_admin() OR public.has_admin_level(auth.uid(),'read_only_admin'));

-- 5. customer_account_match_issues (ambiguous match queue)
CREATE TABLE public.customer_account_match_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verified_phone text NOT NULL,
  candidate_customer_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  resolved_customer_id uuid REFERENCES public.customers(id),
  resolved_by uuid,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.customer_account_match_issues TO service_role;
ALTER TABLE public.customer_account_match_issues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view match issues" ON public.customer_account_match_issues
  FOR SELECT TO authenticated USING (public.is_admin() OR public.has_admin_level(auth.uid(),'read_only_admin'));
CREATE POLICY "Admins can update match issues" ON public.customer_account_match_issues
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 6. customer_verification_config (single-row admin config)
CREATE TABLE public.customer_verification_config (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  otp_ttl_seconds int NOT NULL DEFAULT 600,
  per_phone_cooldown_seconds int NOT NULL DEFAULT 60,
  per_phone_max_per_hour int NOT NULL DEFAULT 5,
  per_ip_max_per_hour int NOT NULL DEFAULT 10,
  max_attempts int NOT NULL DEFAULT 5,
  session_inactivity_seconds int NOT NULL DEFAULT 1800,
  session_absolute_seconds int NOT NULL DEFAULT 43200,
  booking_link_ttl_hours int NOT NULL DEFAULT 72,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.customer_verification_config (id) VALUES ('default') ON CONFLICT DO NOTHING;
GRANT ALL ON public.customer_verification_config TO service_role;
GRANT SELECT ON public.customer_verification_config TO authenticated;
ALTER TABLE public.customer_verification_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated can view verification config" ON public.customer_verification_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can edit verification config" ON public.customer_verification_config
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- updated_at triggers
CREATE TRIGGER trg_customer_accounts_updated BEFORE UPDATE ON public.customer_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cvc_updated BEFORE UPDATE ON public.customer_verification_challenges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cami_updated BEFORE UPDATE ON public.customer_account_match_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cvcfg_updated BEFORE UPDATE ON public.customer_verification_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7. REMOVE insecure email-JWT policies on customers/quotes/bookings.
--    These were the primary Stage-B risk vector: anyone with an email claim
--    could read the corresponding rows. Portal reads now go exclusively
--    through service-role edge functions that validate a portal session.
DROP POLICY IF EXISTS "Customers can view own record by email" ON public.customers;
DROP POLICY IF EXISTS "Customers can view own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Customers can view own quotes by email" ON public.quotes;
DROP POLICY IF EXISTS "Authenticated users can create booking for own customer record" ON public.bookings;
