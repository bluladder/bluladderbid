-- Narrow the authenticated role on the Phase 1G messaging connector table.
--
-- Lovable-hosted table creation hydrated REFERENCES, TRIGGER, and TRUNCATE in
-- addition to the reviewed CRUD grant. This forward-only repair accepts only
-- that exact observed state and changes no row, policy, function, provider,
-- sender, credential, message, or activation setting.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE public.organization_messaging_connectors
  IN SHARE ROW EXCLUSIVE MODE;

DO $phase1g_grant_preflight$
DECLARE
  current_privileges text[];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  IF to_regclass('public.organization_messaging_connectors') IS NULL THEN
    RAISE EXCEPTION 'Phase 1G messaging connector table is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.organization_messaging_connectors'::regclass
      AND relkind = 'r'
      AND relrowsecurity = true
  ) THEN
    RAISE EXCEPTION 'Phase 1G connector RLS state is not exact';
  END IF;
  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_messaging_connectors'
      AND policyname IN (
        'Tenant members view messaging connectors',
        'Tenant operators manage messaging connectors'
      )
  ) <> 2 OR (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_messaging_connectors'
  ) <> 2 THEN
    RAISE EXCEPTION 'Phase 1G connector policy state is not exact';
  END IF;

  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_messaging_connectors'
    AND grantee = 'authenticated';
  IF current_privileges <> expected_all_privileges THEN
    RAISE EXCEPTION
      'Phase 1G authenticated privilege drift is not the observed state: %',
      current_privileges;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_messaging_connectors'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'Phase 1G anonymous connector privilege is present';
  END IF;
  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_messaging_connectors'
    AND grantee = 'service_role';
  IF current_privileges <> expected_all_privileges THEN
    RAISE EXCEPTION 'Phase 1G service-role privilege state changed';
  END IF;

  IF has_function_privilege(
    'anon', 'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Phase 1G lineage function execution grant changed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_messaging_connectors) THEN
    RAISE EXCEPTION 'Phase 1G grant repair requires zero connectors';
  END IF;
  IF (SELECT count(*) FROM public.sms_messages) <> 134
     OR EXISTS (
       SELECT 1 FROM public.sms_messages
       WHERE organization_id IS NULL
          OR organization_id <>
            'b1addf00-0000-4000-8000-000000000001'::uuid
          OR messaging_connector_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Phase 1G reviewed SMS lineage state changed';
  END IF;
  IF (
    SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND status = 'active'
      AND is_legacy_default = true
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.organizations
    WHERE is_legacy_default = true
      AND id <> 'b1addf00-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'Phase 1G DFW authority changed';
  END IF;
  IF (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ) <> 1 OR EXISTS (
    SELECT 1 FROM public.customers customer
    JOIN public.organizations organization
      ON organization.id = customer.organization_id
    WHERE organization.slug = 'bluladder-klamath'
  ) OR EXISTS (
    SELECT 1 FROM public.organization_resolution_keys key
    JOIN public.organizations organization
      ON organization.id = key.organization_id
    WHERE organization.slug = 'bluladder-klamath'
      AND key.key_type IN (
        'jobber_account', 'callrail_number', 'email_address',
        'vapi_assistant', 'vapi_phone_number'
      )
  ) THEN
    RAISE EXCEPTION 'Phase 1G Klamath inactive boundary changed';
  END IF;
END
$phase1g_grant_preflight$;

REVOKE ALL PRIVILEGES
  ON TABLE public.organization_messaging_connectors
  FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_messaging_connectors
  TO authenticated;

DO $phase1g_grant_postflight$
DECLARE
  current_privileges text[];
  expected_crud_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'SELECT', 'UPDATE'
  ];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_messaging_connectors'
    AND grantee = 'authenticated';
  IF current_privileges <> expected_crud_privileges THEN
    RAISE EXCEPTION 'Phase 1G authenticated privileges were not narrowed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY['REFERENCES', 'TRIGGER', 'TRUNCATE'])
      AS privileges(privilege_name)
    WHERE has_table_privilege(
      'authenticated',
      'public.organization_messaging_connectors',
      privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'Phase 1G authenticated role retains excess access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_messaging_connectors'
      AND grantee = 'anon'
  ) THEN
    RAISE EXCEPTION 'Phase 1G anonymous connector access changed';
  END IF;
  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_messaging_connectors'
    AND grantee = 'service_role';
  IF current_privileges <> expected_all_privileges THEN
    RAISE EXCEPTION 'Phase 1G service-role access changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_messaging_connectors)
     OR EXISTS (
       SELECT 1 FROM public.sms_messages
       WHERE organization_id IS NULL
          OR organization_id <>
            'b1addf00-0000-4000-8000-000000000001'::uuid
          OR messaging_connector_id IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Phase 1G grant repair changed data';
  END IF;
END
$phase1g_grant_postflight$;

COMMIT;