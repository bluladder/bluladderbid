-- Narrow the authenticated role on the applied Stage 8A tenant tables.
--
-- The Lovable-hosted database granted all table privileges when Stage 8A
-- created these tables. The applied migration granted the intended CRUD set
-- but did not first revoke the inherited direct grants, so REFERENCES,
-- TRIGGER, and TRUNCATE remained. This forward repair accepts only that exact
-- observed state and leaves RLS, policies, tenant data, and service-role access
-- unchanged.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  public.organization_settings,
  public.organization_contacts,
  public.organization_territories,
  public.organization_services
IN SHARE ROW EXCLUSIVE MODE;

DO $stage8a_authenticated_grant_preflight$
DECLARE
  target_table text;
  current_privileges text[];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  IF to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Retired public membership helper is unexpectedly present';
  END IF;

  IF to_regclass('public.organization_customer_sites') IS NOT NULL
     OR to_regclass('public.organization_pricing_profiles') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM public.organizations
       WHERE id = 'b1addf00-0000-4000-8000-000000000003'
          OR lower(slug) = 'bluladder-klamath'
     ) THEN
    RAISE EXCEPTION 'Phase 1C state exists; apply the Stage 8A grant repair first';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'Stage 8A grant-repair table is missing: %', target_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = target_table
        AND c.relkind = 'r'
        AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'Stage 8A RLS prerequisite is not exact: %', target_table;
    END IF;

    IF (
      SELECT count(*)
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = target_table
    ) <> 2 THEN
      RAISE EXCEPTION 'Stage 8A policy count is not exact: %', target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'authenticated';

    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION
        'Authenticated privilege drift is not the observed Stage 8A state on %: %',
        target_table,
        current_privileges;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'anon';

    IF current_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'Anonymous table privilege is unexpectedly present on %', target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'service_role';

    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION 'Service-role privileges are not exact on %', target_table;
    END IF;
  END LOOP;

  IF (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND display_name = 'BluLadder DFW'
      AND status = 'active'
      AND is_legacy_default = true
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public_name = 'BluLadder DFW'
      AND timezone = 'America/Chicago'
      AND locale = 'en-US'
      AND currency_code = 'USD'
  ) <> 1 THEN
    RAISE EXCEPTION 'DFW Stage 8A baseline is not exact';
  END IF;

  IF (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000002'
      AND slug = 'bluladder-oregon-test'
      AND display_name = 'BluLadder Oregon Test'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ) <> 1 OR (
    SELECT count(*)
    FROM public.organization_territories
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
      AND status = 'inactive'
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_services
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Oregon test fixture is not safely inactive';
  END IF;
END
$stage8a_authenticated_grant_preflight$;

REVOKE ALL PRIVILEGES
  ON TABLE public.organization_settings,
           public.organization_contacts,
           public.organization_territories,
           public.organization_services
  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_settings,
           public.organization_contacts,
           public.organization_territories,
           public.organization_services
  TO authenticated;

DO $stage8a_authenticated_grant_postflight$
DECLARE
  target_table text;
  current_privileges text[];
  expected_crud_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'SELECT', 'UPDATE'
  ];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  ]
  LOOP
    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'authenticated';

    IF current_privileges <> expected_crud_privileges THEN
      RAISE EXCEPTION 'Authenticated privileges were not narrowed on %', target_table;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY['REFERENCES', 'TRIGGER', 'TRUNCATE'])
        AS privileges(privilege_name)
      WHERE has_table_privilege(
        'authenticated',
        format('public.%I', target_table),
        privilege_name
      )
    ) THEN
      RAISE EXCEPTION 'Authenticated role retains an excess privilege on %', target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'anon';

    IF current_privileges <> ARRAY[]::text[] THEN
      RAISE EXCEPTION 'Anonymous access changed on %', target_table;
    END IF;

    SELECT COALESCE(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'service_role';

    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION 'Service-role access changed on %', target_table;
    END IF;
  END LOOP;

  IF to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Retired public membership helper was introduced';
  END IF;
END
$stage8a_authenticated_grant_postflight$;

COMMIT;