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
