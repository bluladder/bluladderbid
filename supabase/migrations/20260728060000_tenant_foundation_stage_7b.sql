-- Issue #7, Stage 7B: additive tenant foundation.
-- Repository migration only. Apply only after hosted-state preflight.

BEGIN;

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'suspended', 'archived')),
  is_legacy_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_one_legacy_default_idx
  ON public.organizations (is_legacy_default)
  WHERE is_legacy_default;

COMMENT ON COLUMN public.organizations.is_legacy_default IS
  'Migration compatibility marker only. It is not a runtime tenant fallback.';

INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES (
  'b1addf00-0000-4000-8000-000000000001',
  'bluladder-dfw',
  'BluLadder DFW',
  'active',
  true
)
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  is_legacy_default = EXCLUDED.is_legacy_default;

CREATE TABLE IF NOT EXISTS public.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'operations', 'read_only')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
  ON public.organization_memberships (user_id, organization_id)
  WHERE status = 'active';

-- Preserve existing DFW administrator access by translating platform roles.
INSERT INTO public.organization_memberships (
  organization_id, user_id, role, status
)
SELECT
  'b1addf00-0000-4000-8000-000000000001',
  ur.user_id,
  CASE ur.role::text
    WHEN 'owner_admin' THEN 'owner'
    WHEN 'admin' THEN 'admin'
    WHEN 'operations_admin' THEN 'operations'
    ELSE 'read_only'
  END,
  'active'
FROM public.user_roles ur
ON CONFLICT (organization_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.organization_resolution_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  key_type text NOT NULL CHECK (
    key_type IN (
      'hostname', 'site', 'embed', 'territory',
      'jobber_account', 'callrail_number', 'email_address',
      'vapi_assistant', 'vapi_phone_number'
    )
  ),
  key_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key_type, key_hash)
);

CREATE INDEX IF NOT EXISTS organization_resolution_keys_org_idx
  ON public.organization_resolution_keys (organization_id, key_type);

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS organization_id uuid;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS organization_id uuid;

-- Bounded compatibility backfill: repository history represents one DFW business.
-- No DEFAULT is installed; new authoritative writes must resolve server-side.
UPDATE public.customers
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

UPDATE public.properties
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

UPDATE public.quotes
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

UPDATE public.bookings
SET organization_id = 'b1addf00-0000-4000-8000-000000000001'
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS customers_organization_id_idx
  ON public.customers (organization_id);
CREATE INDEX IF NOT EXISTS properties_organization_id_idx
  ON public.properties (organization_id);
CREATE INDEX IF NOT EXISTS quotes_organization_id_idx
  ON public.quotes (organization_id);
CREATE INDEX IF NOT EXISTS bookings_organization_id_idx
  ON public.bookings (organization_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_organization_id_fkey'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'properties_organization_id_fkey'
  ) THEN
    ALTER TABLE public.properties
      ADD CONSTRAINT properties_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quotes_organization_id_fkey'
  ) THEN
    ALTER TABLE public.quotes
      ADD CONSTRAINT quotes_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_organization_id_fkey'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES public.organizations(id) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.customers VALIDATE CONSTRAINT customers_organization_id_fkey;
ALTER TABLE public.properties VALIDATE CONSTRAINT properties_organization_id_fkey;
ALTER TABLE public.quotes VALIDATE CONSTRAINT quotes_organization_id_fkey;
ALTER TABLE public.bookings VALIDATE CONSTRAINT bookings_organization_id_fkey;

CREATE OR REPLACE FUNCTION public.is_organization_member(
  _organization_id uuid,
  _user_id uuid DEFAULT auth.uid()
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.organization_id = _organization_id
      AND om.user_id = _user_id
      AND om.status = 'active'
      AND o.status = 'active'
  )
$$;

REVOKE ALL ON FUNCTION public.is_organization_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_organization_member(uuid, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_first_wave_organization_lineage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_organization_id uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'bookings' AND NEW.customer_id IS NOT NULL THEN
    SELECT organization_id INTO parent_organization_id
    FROM public.customers WHERE id = NEW.customer_id;
  ELSIF TG_TABLE_NAME = 'quotes' AND NEW.customer_id IS NOT NULL THEN
    SELECT organization_id INTO parent_organization_id
    FROM public.customers WHERE id = NEW.customer_id;
  END IF;

  IF parent_organization_id IS NOT NULL
     AND parent_organization_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'organization lineage mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS enforce_bookings_organization_lineage ON public.bookings;
CREATE TRIGGER enforce_bookings_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();

DROP TRIGGER IF EXISTS enforce_quotes_organization_lineage ON public.quotes;
CREATE TRIGGER enforce_quotes_organization_lineage
  BEFORE INSERT OR UPDATE OF organization_id, customer_id ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_first_wave_organization_lineage();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_resolution_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view active organizations"
  ON public.organizations;
CREATE POLICY "Members can view active organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_organization_member(id));

DROP POLICY IF EXISTS "Members can view memberships in their organizations"
  ON public.organization_memberships;
CREATE POLICY "Members can view memberships in their organizations"
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Organization admins manage memberships"
  ON public.organization_memberships;
CREATE POLICY "Organization admins manage memberships"
  ON public.organization_memberships FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_memberships.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_memberships.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "Organization admins manage resolution keys"
  ON public.organization_resolution_keys;
CREATE POLICY "Organization admins manage resolution keys"
  ON public.organization_resolution_keys FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_resolution_keys.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.organization_memberships actor
      WHERE actor.organization_id = organization_resolution_keys.organization_id
        AND actor.user_id = auth.uid()
        AND actor.status = 'active'
        AND actor.role IN ('owner', 'admin')
    )
  );

-- Restrictive policies are additive: existing purpose/role policies must also pass.
DROP POLICY IF EXISTS "Tenant boundary customers" ON public.customers;
CREATE POLICY "Tenant boundary customers"
  ON public.customers AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id IS NULL OR public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NULL OR public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Tenant boundary properties" ON public.properties;
CREATE POLICY "Tenant boundary properties"
  ON public.properties AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id IS NULL OR public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NULL OR public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Tenant boundary quotes" ON public.quotes;
CREATE POLICY "Tenant boundary quotes"
  ON public.quotes AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id IS NULL OR public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NULL OR public.is_organization_member(organization_id));

DROP POLICY IF EXISTS "Tenant boundary bookings" ON public.bookings;
CREATE POLICY "Tenant boundary bookings"
  ON public.bookings AS RESTRICTIVE FOR ALL TO authenticated
  USING (organization_id IS NULL OR public.is_organization_member(organization_id))
  WITH CHECK (organization_id IS NULL OR public.is_organization_member(organization_id));

GRANT SELECT ON public.organizations, public.organization_memberships
  TO authenticated;
GRANT ALL ON public.organizations, public.organization_memberships,
  public.organization_resolution_keys TO service_role;

COMMIT;
