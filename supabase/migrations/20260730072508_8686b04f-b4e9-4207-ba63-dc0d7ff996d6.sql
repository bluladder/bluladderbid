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


-- Stage 7B release-candidate security correction.
-- This fragment is assembled inside the immutable Stage 7B transaction.
-- It must never be executed independently or against hosted infrastructure
-- without a separately authorized release window.

CREATE SCHEMA IF NOT EXISTS tenant_security AUTHORIZATION postgres;

REVOKE ALL ON SCHEMA tenant_security
  FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA tenant_security TO authenticated;

CREATE OR REPLACE FUNCTION tenant_security.is_platform_organization_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text IN ('owner_admin', 'admin')
    )
$$;

CREATE OR REPLACE FUNCTION tenant_security.current_organization_role(
  _organization_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT om.role
  FROM public.organization_memberships om
  JOIN public.organizations o
    ON o.id = om.organization_id
  WHERE auth.uid() IS NOT NULL
    AND om.organization_id = _organization_id
    AND om.user_id = auth.uid()
    AND om.status = 'active'
    AND o.status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION tenant_security.can_manage_membership_role(
  _organization_id uuid,
  _target_role text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    tenant_security.is_platform_organization_admin()
    OR CASE tenant_security.current_organization_role(_organization_id)
      WHEN 'owner' THEN _target_role IN ('admin', 'operations', 'read_only')
      WHEN 'admin' THEN _target_role IN ('operations', 'read_only')
      ELSE false
    END
$$;

ALTER FUNCTION tenant_security.is_platform_organization_admin()
  OWNER TO postgres;
ALTER FUNCTION tenant_security.current_organization_role(uuid)
  OWNER TO postgres;
ALTER FUNCTION tenant_security.can_manage_membership_role(uuid, text)
  OWNER TO postgres;

REVOKE ALL
  ON FUNCTION tenant_security.is_platform_organization_admin(),
              tenant_security.current_organization_role(uuid),
              tenant_security.can_manage_membership_role(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE
  ON FUNCTION tenant_security.is_platform_organization_admin(),
              tenant_security.current_organization_role(uuid),
              tenant_security.can_manage_membership_role(uuid, text)
  TO authenticated;

DROP POLICY IF EXISTS "Members can view active organizations"
  ON public.organizations;
CREATE POLICY "Members can view active organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (
    tenant_security.current_organization_role(id) IS NOT NULL
    OR tenant_security.is_platform_organization_admin()
  );

DROP POLICY IF EXISTS "Members can view memberships in their organizations"
  ON public.organization_memberships;
CREATE POLICY "Members can view memberships in their organizations"
  ON public.organization_memberships FOR SELECT TO authenticated
  USING (
    tenant_security.current_organization_role(organization_id) IS NOT NULL
    OR tenant_security.is_platform_organization_admin()
  );

DROP POLICY IF EXISTS "Organization admins manage memberships"
  ON public.organization_memberships;
DROP POLICY IF EXISTS "Organization admins insert memberships"
  ON public.organization_memberships;
CREATE POLICY "Organization admins insert memberships"
  ON public.organization_memberships FOR INSERT TO authenticated
  WITH CHECK (
    tenant_security.can_manage_membership_role(organization_id, role)
  );

DROP POLICY IF EXISTS "Organization admins update memberships"
  ON public.organization_memberships;
CREATE POLICY "Organization admins update memberships"
  ON public.organization_memberships FOR UPDATE TO authenticated
  USING (
    tenant_security.can_manage_membership_role(organization_id, role)
  )
  WITH CHECK (
    tenant_security.can_manage_membership_role(organization_id, role)
  );

DROP POLICY IF EXISTS "Organization admins delete memberships"
  ON public.organization_memberships;
CREATE POLICY "Organization admins delete memberships"
  ON public.organization_memberships FOR DELETE TO authenticated
  USING (
    tenant_security.can_manage_membership_role(organization_id, role)
  );

DROP POLICY IF EXISTS "Organization admins manage resolution keys"
  ON public.organization_resolution_keys;
CREATE POLICY "Organization admins manage resolution keys"
  ON public.organization_resolution_keys FOR ALL TO authenticated
  USING (
    tenant_security.current_organization_role(organization_id)
      IN ('owner', 'admin')
    OR tenant_security.is_platform_organization_admin()
  )
  WITH CHECK (
    tenant_security.current_organization_role(organization_id)
      IN ('owner', 'admin')
    OR tenant_security.is_platform_organization_admin()
  );

DROP POLICY IF EXISTS "Tenant boundary customers" ON public.customers;
CREATE POLICY "Tenant boundary customers"
  ON public.customers AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  );

DROP POLICY IF EXISTS "Tenant boundary properties" ON public.properties;
CREATE POLICY "Tenant boundary properties"
  ON public.properties AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  );

DROP POLICY IF EXISTS "Tenant boundary quotes" ON public.quotes;
CREATE POLICY "Tenant boundary quotes"
  ON public.quotes AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  );

DROP POLICY IF EXISTS "Tenant boundary bookings" ON public.bookings;
CREATE POLICY "Tenant boundary bookings"
  ON public.bookings AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  )
  WITH CHECK (
    organization_id IS NOT NULL
    AND tenant_security.current_organization_role(organization_id) IS NOT NULL
  );

REVOKE ALL
  ON public.organizations,
     public.organization_memberships,
     public.organization_resolution_keys
  FROM anon;
REVOKE INSERT, UPDATE, DELETE
  ON public.organizations
  FROM authenticated;
GRANT SELECT
  ON public.organizations
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.organization_memberships,
     public.organization_resolution_keys
  TO authenticated;

DROP FUNCTION IF EXISTS public.is_organization_member(uuid, uuid);

-- Stage 7B Lovable Cloud atomic release provenance.
-- This fragment is assembled after the security correction and before the
-- sole COMMIT. It must never be executed independently.
--
-- The artifact identity is canonical: SHA-256 is calculated with the
-- embedded 64-character digest normalized back to the assembler token. This avoids
-- an impossible cryptographic self-reference while binding the database row to
-- one deterministic SQL artifact.

CREATE TABLE IF NOT EXISTS tenant_security.release_provenance (
  release_id text PRIMARY KEY,
  release_commit text NOT NULL,
  source_sha256 text NOT NULL,
  correction_sha256 text NOT NULL,
  artifact_sha256 text NOT NULL,
  project_ref text NOT NULL,
  environment text NOT NULL,
  operator_identity text NOT NULL,
  approval_record text NOT NULL,
  execution_mechanism text NOT NULL,
  execution_started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_outcome text NOT NULL
    CHECK (transaction_outcome = 'committed'),
  CHECK (release_commit ~ '^[0-9a-f]{40}$'),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (correction_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (btrim(operator_identity) <> ''),
  CHECK (btrim(approval_record) <> '')
);

ALTER TABLE tenant_security.release_provenance OWNER TO postgres;
REVOKE ALL ON tenant_security.release_provenance
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION tenant_security.reject_release_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'release provenance is append-only';
END
$$;
ALTER FUNCTION tenant_security.reject_release_provenance_mutation()
  OWNER TO postgres;
REVOKE ALL
  ON FUNCTION tenant_security.reject_release_provenance_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS release_provenance_append_only
  ON tenant_security.release_provenance;
CREATE TRIGGER release_provenance_append_only
  BEFORE UPDATE OR DELETE ON tenant_security.release_provenance
  FOR EACH ROW
  EXECUTE FUNCTION tenant_security.reject_release_provenance_mutation();

CREATE OR REPLACE FUNCTION tenant_security.record_stage7b_lovable_provenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_release_id constant text :=
    'tenant-foundation-stage-7b-lovable-v1';
  v_release_commit constant text :=
    'e8000543d015dec7b6ab16110e4798f596398681';
  v_source_sha256 constant text :=
    'b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca';
  v_correction_sha256 constant text :=
    'abcc90c9044b32fc02fce5f7c3fd445f91fe4f186c5c8a2ee93007809f3a69d0';
  v_artifact_sha256 constant text := '8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e';
  v_target_project_ref constant text := 'gyndziiuizpgwhqwyrvn';
  v_environment constant text := 'Live/production';
  v_operator_identity constant text := 'benjamin-millen';
  v_approval_record constant text :=
    'owner-operated-lovable-stage7b-v1';
  v_execution_started_at constant timestamptz := transaction_timestamp();
BEGIN
  IF v_target_project_ref <> 'gyndziiuizpgwhqwyrvn' THEN
    RAISE EXCEPTION 'wrong Stage 7B project identity';
  END IF;
  IF v_environment <> 'Live/production' THEN
    RAISE EXCEPTION 'wrong Stage 7B environment';
  END IF;

  INSERT INTO tenant_security.release_provenance (
    release_id,
    release_commit,
    source_sha256,
    correction_sha256,
    artifact_sha256,
    project_ref,
    environment,
    operator_identity,
    approval_record,
    execution_mechanism,
    execution_started_at,
    transaction_outcome
  ) VALUES (
    v_release_id,
    v_release_commit,
    v_source_sha256,
    v_correction_sha256,
    v_artifact_sha256,
    v_target_project_ref,
    v_environment,
    v_operator_identity,
    v_approval_record,
    'lovable_cloud_approval',
    v_execution_started_at,
    'committed'
  )
  ON CONFLICT (release_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM tenant_security.release_provenance rp
    WHERE rp.release_id = v_release_id
      AND rp.release_commit = v_release_commit
      AND rp.source_sha256 = v_source_sha256
      AND rp.correction_sha256 = v_correction_sha256
      AND rp.artifact_sha256 = v_artifact_sha256
      AND rp.project_ref = v_target_project_ref
      AND rp.environment = v_environment
      AND rp.operator_identity = v_operator_identity
      AND rp.approval_record = v_approval_record
      AND rp.execution_mechanism = 'lovable_cloud_approval'
      AND rp.transaction_outcome = 'committed'
  ) THEN
    RAISE EXCEPTION 'existing Stage 7B provenance does not match this release';
  END IF;
END
$$;

ALTER FUNCTION tenant_security.record_stage7b_lovable_provenance()
  OWNER TO postgres;
REVOKE ALL
  ON FUNCTION tenant_security.record_stage7b_lovable_provenance()
  FROM PUBLIC, anon, authenticated, service_role;

SELECT tenant_security.record_stage7b_lovable_provenance();

COMMIT;