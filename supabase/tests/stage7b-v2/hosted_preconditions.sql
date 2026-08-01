\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    CREATE ROLE sandbox_exec NOLOGIN;
  END IF;
END
$$;

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL
);
CREATE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role IN ('owner_admin', 'admin')
  )
$$;
CREATE FUNCTION public.has_admin_level(uuid, text) RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT public.is_admin() $$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL,
  is_legacy_default boolean NOT NULL DEFAULT false
);
CREATE TABLE public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL,
  status text NOT NULL,
  UNIQUE (organization_id, user_id)
);
CREATE TABLE public.organization_resolution_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  key_type text NOT NULL,
  key_hash text NOT NULL,
  status text NOT NULL,
  UNIQUE (key_type, key_hash)
);

CREATE SCHEMA tenant_security;
CREATE FUNCTION tenant_security.is_platform_organization_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('owner_admin', 'admin')
  )
$$;
CREATE FUNCTION tenant_security.current_organization_role(uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT om.role
  FROM public.organization_memberships om
  JOIN public.organizations o ON o.id = om.organization_id
  WHERE om.organization_id = $1
    AND om.user_id = auth.uid()
    AND om.status = 'active'
    AND o.status = 'active'
  LIMIT 1
$$;
REVOKE ALL ON SCHEMA tenant_security FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA tenant_security TO authenticated;
REVOKE ALL ON FUNCTION tenant_security.is_platform_organization_admin(),
  tenant_security.current_organization_role(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION tenant_security.is_platform_organization_admin(),
  tenant_security.current_organization_role(uuid) TO authenticated;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.properties (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  customer_id uuid REFERENCES public.customers(id),
  property_id uuid REFERENCES public.properties(id)
);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY,
  organization_id uuid REFERENCES public.organizations(id),
  customer_id uuid REFERENCES public.customers(id),
  property_id uuid REFERENCES public.properties(id)
);
CREATE FUNCTION public.enforce_first_wave_organization_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN RETURN NEW; END $$;
CREATE TRIGGER enforce_quotes_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();
CREATE TRIGGER enforce_bookings_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();

CREATE TABLE public.quote_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  conversation_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  customer_id uuid,
  property_id uuid,
  quote_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token text NOT NULL,
  customer_id uuid,
  confirmed_email_customer_id uuid,
  property_id uuid,
  quote_session_id uuid
);

ALTER TABLE public.quote_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
-- Deliberately broad permissive policies prove that the migration's
-- restrictive tenant boundary remains decisive even if another purpose
-- policy is overly generous.
CREATE POLICY "Admins can read quote sessions" ON public.quote_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can view chat conversations" ON public.chat_conversations
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can update chat conversations" ON public.chat_conversations
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
GRANT ALL ON public.quote_sessions, public.chat_conversations
  TO anon, authenticated, service_role;
GRANT INSERT, SELECT ON public.quote_sessions, public.chat_conversations
  TO sandbox_exec;

CREATE VIEW public.admin_marketing_funnel AS SELECT id FROM public.quotes;
CREATE VIEW public.eligibility_rules_public AS SELECT id FROM public.organizations;
CREATE VIEW public.property_facts_current AS SELECT id FROM public.properties;
CREATE VIEW public.technicians_public AS SELECT id FROM public.organizations;
GRANT ALL ON public.admin_marketing_funnel,
  public.eligibility_rules_public,
  public.property_facts_current,
  public.technicians_public TO anon, authenticated, service_role;

INSERT INTO auth.users(id) VALUES
  ('a0000000-0000-4000-8000-000000000001'),
  ('a0000000-0000-4000-8000-000000000002'),
  ('a0000000-0000-4000-8000-000000000003'),
  ('a0000000-0000-4000-8000-000000000004');
INSERT INTO public.user_roles(user_id, role) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'admin');
INSERT INTO public.organizations(id, slug, display_name, status) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'tenant-a', 'Tenant A', 'active'),
  ('b0000000-0000-4000-8000-000000000002', 'tenant-b', 'Tenant B', 'active');
INSERT INTO public.organization_memberships(
  organization_id, user_id, role, status
) VALUES
  ('b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'admin', 'active'),
  ('b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000002', 'operations', 'active'),
  ('b0000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000003', 'operations', 'active'),
  ('b0000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000004', 'operations', 'inactive');
INSERT INTO public.customers(id, organization_id) VALUES
  ('c0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001'),
  ('c0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002'),
  ('c0000000-0000-4000-8000-000000000003', NULL);
INSERT INTO public.properties(id, organization_id) VALUES
  ('d0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000002');
INSERT INTO public.quotes(id, organization_id, customer_id, property_id) VALUES
  ('e0000000-0000-4000-8000-000000000001',
   'b0000000-0000-4000-8000-000000000001',
   'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001');
INSERT INTO public.quote_sessions(
  id, channel, customer_id, property_id, quote_id
) VALUES
  ('f0000000-0000-4000-8000-000000000001', 'voice',
   'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'e0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002', 'voice', NULL, NULL, NULL);
INSERT INTO public.chat_conversations(
  id, session_token, customer_id, property_id, quote_session_id
) VALUES
  ('90000000-0000-4000-8000-000000000001', 'scoped-a',
   'c0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   'f0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002', 'unscoped', NULL, NULL,
   'f0000000-0000-4000-8000-000000000002');
