-- Narrow authenticated access on the Phase 1I CRM connector lineage tables.
--
-- Lovable-hosted table creation hydrated REFERENCES, TRIGGER, and TRUNCATE in
-- addition to the reviewed connector CRUD and audit-ledger SELECT grants. This
-- forward-only repair accepts only that exact observed state. It changes no
-- row, policy, provider, credential, webhook, runtime, or activation setting.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

LOCK TABLE
  public.organization_crm_connectors,
  public.organization_connector_operation_attempts,
  public.organization_connector_webhook_receipts
IN SHARE ROW EXCLUSIVE MODE;

DO $phase1i_grant_preflight$
DECLARE
  target_table text;
  current_privileges text[];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'organization_crm_connectors',
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
  ]
  LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      RAISE EXCEPTION 'Phase 1I grant-repair table is missing: %', target_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = target_table
        AND relation.relkind = 'r'
        AND relation.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'Phase 1I RLS prerequisite is not exact: %', target_table;
    END IF;

    SELECT coalesce(
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
        'Phase 1I authenticated privilege drift is not observed state on %: %',
        target_table,
        current_privileges;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND grantee = 'anon'
    ) THEN
      RAISE EXCEPTION 'Phase 1I anonymous privilege is present on %', target_table;
    END IF;

    SELECT coalesce(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    )
    INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'service_role';
    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION 'Phase 1I service-role privileges changed on %', target_table;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'organization_crm_connectors'
        AND policyname IN (
          'Tenant operators view CRM connectors',
          'Tenant operators manage CRM connectors'
        )) <> 2
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_crm_connectors') <> 2
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_operation_attempts'
          AND policyname = 'Tenant operators view CRM operation attempts') <> 1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_operation_attempts') <> 1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_webhook_receipts'
          AND policyname = 'Tenant operators view CRM webhook receipts') <> 1
    OR (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'organization_connector_webhook_receipts') <> 1 THEN
    RAISE EXCEPTION 'Phase 1I policy state is not exact';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_crm_connectors)
    OR EXISTS (SELECT 1 FROM public.organization_connector_operation_attempts)
    OR EXISTS (SELECT 1 FROM public.organization_connector_webhook_receipts) THEN
    RAISE EXCEPTION 'Phase 1I grant repair requires empty connector tables';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR EXISTS (
      SELECT 1 FROM public.organizations
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
    ) THEN
    RAISE EXCEPTION 'Phase 1I DFW authority changed';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.customers
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.chat_conversations
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.bookings
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_resolution_keys
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND key_type IN (
          'jobber_account', 'jobtread_account', 'google_calendar',
          'callrail_number', 'twilio_number', 'vapi_assistant',
          'vapi_phone_number'
        )
    ) THEN
    RAISE EXCEPTION 'Phase 1I Klamath inactive boundary changed';
  END IF;
END
$phase1i_grant_preflight$;

REVOKE ALL PRIVILEGES
  ON TABLE public.organization_crm_connectors
  FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.organization_crm_connectors
  TO authenticated;

REVOKE ALL PRIVILEGES
  ON TABLE public.organization_connector_operation_attempts,
           public.organization_connector_webhook_receipts
  FROM authenticated;
GRANT SELECT
  ON TABLE public.organization_connector_operation_attempts,
           public.organization_connector_webhook_receipts
  TO authenticated;

DO $phase1i_grant_postflight$
DECLARE
  current_privileges text[];
  expected_connector_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'SELECT', 'UPDATE'
  ];
  expected_audit_privileges constant text[] := ARRAY['SELECT'];
  expected_all_privileges constant text[] := ARRAY[
    'DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
  ];
  target_table text;
BEGIN
  SELECT coalesce(
    array_agg(privilege_type::text ORDER BY privilege_type::text),
    ARRAY[]::text[]
  ) INTO current_privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_crm_connectors'
    AND grantee = 'authenticated';
  IF current_privileges <> expected_connector_privileges THEN
    RAISE EXCEPTION 'Phase 1I connector privileges were not narrowed';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
  ]
  LOOP
    SELECT coalesce(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    ) INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'authenticated';
    IF current_privileges <> expected_audit_privileges THEN
      RAISE EXCEPTION 'Phase 1I audit privileges were not narrowed on %', target_table;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    ]) AS target_tables(target_table)
    CROSS JOIN unnest(ARRAY['REFERENCES', 'TRIGGER', 'TRUNCATE'])
      AS privileges(privilege_name)
    WHERE has_table_privilege(
      'authenticated', format('public.%I', target_table), privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'Phase 1I authenticated role retains excess privileges';
  END IF;

  FOREACH target_table IN ARRAY ARRAY[
    'organization_crm_connectors',
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name = target_table
        AND grantee = 'anon'
    ) THEN
      RAISE EXCEPTION 'Phase 1I anonymous access changed on %', target_table;
    END IF;
    SELECT coalesce(
      array_agg(privilege_type::text ORDER BY privilege_type::text),
      ARRAY[]::text[]
    ) INTO current_privileges
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = target_table
      AND grantee = 'service_role';
    IF current_privileges <> expected_all_privileges THEN
      RAISE EXCEPTION 'Phase 1I service-role access changed on %', target_table;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.organization_crm_connectors)
    OR EXISTS (SELECT 1 FROM public.organization_connector_operation_attempts)
    OR EXISTS (SELECT 1 FROM public.organization_connector_webhook_receipts) THEN
    RAISE EXCEPTION 'Phase 1I grant repair changed data';
  END IF;
END
$phase1i_grant_postflight$;

COMMIT;
