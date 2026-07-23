
-- Link Supabase Auth users to customer_accounts for the new Google + magic-link
-- login path. This is additive; the legacy phone/email OTP path continues to
-- work against verified_phone / verified_email.
ALTER TABLE public.customer_accounts
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT,
  ADD COLUMN IF NOT EXISTS auth_linked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS customer_accounts_auth_user_id_key
  ON public.customer_accounts (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- Audit trail for identity linking decisions. Never contains tokens.
CREATE TABLE IF NOT EXISTS public.customer_auth_link_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id UUID,
  auth_email TEXT,
  auth_provider TEXT,
  outcome TEXT NOT NULL,           -- linked_existing | linked_new_account | ambiguous | error
  customer_id UUID,
  matched_count INTEGER,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.customer_auth_link_events TO authenticated;
GRANT ALL ON public.customer_auth_link_events TO service_role;
ALTER TABLE public.customer_auth_link_events ENABLE ROW LEVEL SECURITY;

-- Only admins may read the audit log; the linker itself writes via service role.
CREATE POLICY "Admins can view auth link events"
  ON public.customer_auth_link_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
