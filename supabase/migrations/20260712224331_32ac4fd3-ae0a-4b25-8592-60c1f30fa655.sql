
-- Approved test identities (matched by normalized email / E.164 phone)
CREATE TABLE public.test_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_identities TO authenticated;
GRANT ALL ON public.test_identities TO service_role;
ALTER TABLE public.test_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage test identities"
  ON public.test_identities FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Read-only admins view test identities"
  ON public.test_identities FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE TRIGGER trg_test_identities_updated
  BEFORE UPDATE ON public.test_identities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Global, administrator-controlled system-test suppression switch (single row)
CREATE TABLE public.system_test_config (
  id text PRIMARY KEY DEFAULT 'default',
  suppress_all boolean NOT NULL DEFAULT false,
  suppress_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_test_config TO authenticated;
GRANT ALL ON public.system_test_config TO service_role;
ALTER TABLE public.system_test_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage system test config"
  ON public.system_test_config FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(), 'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(), 'operations_admin'));

CREATE POLICY "Read-only admins view system test config"
  ON public.system_test_config FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

INSERT INTO public.system_test_config (id, suppress_all, suppress_reason)
VALUES ('default', false, NULL)
ON CONFLICT (id) DO NOTHING;

-- Keep suppressed messages inspectable in the queue/log
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS suppressed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS suppressed_reason text;

-- Seed the approved production test identity (normalized email + E.164 phone)
INSERT INTO public.test_identities (name, email, phone, active, note)
VALUES ('BluLadder Booking Test', 'blmillen@gmail.com', '+14692150144', true, 'Owner-approved end-to-end test identity')
ON CONFLICT DO NOTHING;
