\set ON_ERROR_STOP on

-- Hostile authorization fixtures are explicitly non-Oregon and disposable.
INSERT INTO auth.users(id) VALUES
  ('d0000000-0000-4000-8000-000000000001'),
  ('d0000000-0000-4000-8000-000000000002'),
  ('d0000000-0000-4000-8000-000000000003'),
  ('d0000000-0000-4000-8000-000000000004'),
  ('d0000000-0000-4000-8000-000000000005'),
  ('d0000000-0000-4000-8000-000000000006')
ON CONFLICT DO NOTHING;

INSERT INTO public.organizations (
  id, slug, display_name, status, is_legacy_default
) VALUES (
  'e0000000-0000-4000-8000-000000000001',
  'rehearsal-other',
  'Rehearsal Other',
  'active',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_memberships (
  organization_id, user_id, role, status
) VALUES
  (
    'b1addf00-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'owner',
    'active'
  ),
  (
    'b1addf00-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000002',
    'admin',
    'active'
  ),
  (
    'b1addf00-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000003',
    'read_only',
    'active'
  ),
  (
    'e0000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000004',
    'admin',
    'active'
  )
ON CONFLICT (organization_id, user_id) DO NOTHING;

DO $$
DECLARE
  function_count integer;
BEGIN
  IF to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'caller-selectable membership helper still exists';
  END IF;

  SELECT count(*) INTO function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_roles owner_role ON owner_role.oid = p.proowner
  WHERE n.nspname = 'tenant_security'
    AND p.proname IN (
      'is_platform_organization_admin',
      'current_organization_role',
      'can_manage_membership_role'
    )
    AND p.prosecdef
    AND p.proconfig = ARRAY['search_path=pg_catalog']
    AND owner_role.rolname = 'postgres';
  IF function_count <> 3 THEN
    RAISE EXCEPTION 'hardened helper ownership/configuration invariant failed';
  END IF;

  IF has_schema_privilege('anon', 'tenant_security', 'USAGE')
     OR has_function_privilege(
       'anon',
       'tenant_security.current_organization_role(uuid)',
       'EXECUTE'
     )
     OR has_table_privilege(
       'anon',
       'public.organization_memberships',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'anonymous organization access was granted';
  END IF;

  IF NOT (
    has_table_privilege(
      'authenticated',
      'public.organization_memberships',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    AND has_table_privilege(
      'authenticated',
      'public.organization_resolution_keys',
      'SELECT,INSERT,UPDATE,DELETE'
    )
  ) THEN
    RAISE EXCEPTION 'authenticated control-plane grants are incomplete';
  END IF;

  IF has_table_privilege(
    'authenticated',
    'public.organizations',
    'INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'authenticated organization DML is broader than approved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_memberships'
      AND (
        coalesce(qual, '') ILIKE '%organization_memberships actor%'
        OR coalesce(with_check, '') ILIKE '%organization_memberships actor%'
      )
  ) THEN
    RAISE EXCEPTION 'membership policy contains a recursive table subquery';
  END IF;

  IF to_regclass('public.organization_settings') IS NOT NULL
     OR to_regclass('public.organization_contacts') IS NOT NULL
     OR to_regclass('public.organization_territories') IS NOT NULL
     OR to_regclass('public.organization_service_availability') IS NOT NULL THEN
    RAISE EXCEPTION 'Stage 8A objects were executed';
  END IF;
END $$;

-- A tenant admin can manage only non-administrative roles in their own tenant.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-4000-8000-000000000002',
  true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_memberships) <> 4 THEN
    RAISE EXCEPTION 'DFW admin membership visibility crossed tenants';
  END IF;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, status
  ) VALUES (
    'b1addf00-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000005',
    'operations',
    'active'
  );

  UPDATE public.organization_memberships
  SET role = 'read_only'
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
    AND user_id = 'd0000000-0000-4000-8000-000000000005';

  DELETE FROM public.organization_memberships
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
    AND user_id = 'd0000000-0000-4000-8000-000000000005';

  BEGIN
    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status
    ) VALUES (
      'e0000000-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000005',
      'read_only',
      'active'
    );
    RAISE EXCEPTION 'cross-organization insert unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status
    ) VALUES (
      'b1addf00-0000-4000-8000-000000000001',
      'd0000000-0000-4000-8000-000000000005',
      'owner',
      'active'
    );
    RAISE EXCEPTION 'tenant admin escalated a membership to owner';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
ROLLBACK;

-- Read-only and unaffiliated identities receive visibility only when authorized,
-- and table grants do not bypass RLS.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-4000-8000-000000000003',
  true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_memberships) <> 4 THEN
    RAISE EXCEPTION 'read-only member visibility crossed tenants';
  END IF;
  BEGIN
    DELETE FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001';
    IF FOUND THEN
      RAISE EXCEPTION 'read-only membership delete unexpectedly succeeded';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-4000-8000-000000000006',
  true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_memberships) <> 0 THEN
    RAISE EXCEPTION 'unaffiliated user saw membership rows';
  END IF;
  IF (SELECT count(*) FROM public.customers) <> 0 THEN
    RAISE EXCEPTION 'unaffiliated user saw DFW business rows';
  END IF;
END $$;
ROLLBACK;

-- The translated platform administrator remains explicit and testable.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  true
);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.organization_memberships) <> 5 THEN
    RAISE EXCEPTION 'platform administrator control-plane access failed';
  END IF;
  IF (SELECT count(*) FROM public.customers) <> 16 THEN
    RAISE EXCEPTION 'legacy DFW compatibility failed';
  END IF;
END $$;
ROLLBACK;

-- Nullable columns remain migration-safe, but authenticated RLS fails closed.
INSERT INTO public.customers(id, organization_id)
VALUES ('f0000000-0000-4000-8000-000000000001', NULL);
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  'd0000000-0000-4000-8000-000000000001',
  true
);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = 'f0000000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'null tenant row was visible';
  END IF;
END $$;
ROLLBACK;
DELETE FROM public.customers
WHERE id = 'f0000000-0000-4000-8000-000000000001';
