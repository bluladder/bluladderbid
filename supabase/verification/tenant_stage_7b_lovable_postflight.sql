BEGIN TRANSACTION READ ONLY;

SELECT 1 / CASE
  WHEN 'gyndziiuizpgwhqwyrvn' = 'gyndziiuizpgwhqwyrvn' THEN 1 ELSE 0
END AS project_identity_ok;
SELECT 1 / CASE
  WHEN 'Live/production' = 'Live/production' THEN 1 ELSE 0
END AS environment_identity_ok;

SELECT
  count(*) AS ledger_count,
  max(version) AS ledger_tip,
  md5(string_agg(version || ':' || name, '|' ORDER BY version)) AS ledger_fingerprint,
  count(*) FILTER (WHERE version = '20260728060000')
    AS direct_execution_ledger_rows
FROM supabase_migrations.schema_migrations;

SELECT
  (SELECT count(*) FROM public.customers WHERE organization_id IS NULL) +
  (SELECT count(*) FROM public.properties WHERE organization_id IS NULL) +
  (SELECT count(*) FROM public.quotes WHERE organization_id IS NULL) +
  (SELECT count(*) FROM public.bookings WHERE organization_id IS NULL)
    AS first_wave_null_count;

SELECT count(*) AS lineage_mismatch_count
FROM (
  SELECT q.id
  FROM public.quotes q
  JOIN public.customers c ON c.id = q.customer_id
  WHERE q.organization_id IS DISTINCT FROM c.organization_id
  UNION ALL
  SELECT b.id
  FROM public.bookings b
  JOIN public.customers c ON c.id = b.customer_id
  WHERE b.organization_id IS DISTINCT FROM c.organization_id
) mismatches;

SELECT
  count(*) FILTER (WHERE convalidated) AS validated_foreign_keys
FROM pg_constraint
WHERE conname IN (
  'customers_organization_id_fkey',
  'properties_organization_id_fkey',
  'quotes_organization_id_fkey',
  'bookings_organization_id_fkey'
);

SELECT
  count(*) AS canonical_dfw_count,
  count(*) FILTER (WHERE status = 'active') AS active_dfw_count
FROM public.organizations
WHERE id = 'b1addf00-0000-4000-8000-000000000001'
  AND slug = 'bluladder-dfw'
  AND is_legacy_default;

SELECT count(*) AS active_oregon_count
FROM public.organizations
WHERE slug ILIKE '%oregon%' AND status = 'active';

SELECT
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
  recorded_at,
  transaction_outcome
FROM tenant_security.release_provenance
WHERE release_id = 'tenant-foundation-stage-7b-lovable-v1'
  AND artifact_sha256 = '8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e'
  AND project_ref = 'gyndziiuizpgwhqwyrvn'
  AND environment = 'Live/production';

SELECT
  has_table_privilege('anon', 'tenant_security.release_provenance', 'SELECT')
    AS anon_can_read,
  has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'SELECT'
  ) AS authenticated_can_read,
  has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'SELECT'
  ) AS service_role_can_read;

SELECT
  count(*) FILTER (
    WHERE p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig @> ARRAY['search_path=pg_catalog']
  ) AS hardened_helper_functions,
  count(*) AS helper_function_count
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'tenant_security'
  AND p.proname IN (
    'is_platform_organization_admin',
    'current_organization_role',
    'can_manage_membership_role'
  );

SELECT count(*) AS corrected_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (tablename = 'organizations'
      AND policyname = 'Members can view active organizations')
    OR (tablename = 'organization_memberships'
      AND policyname IN (
        'Members can view memberships in their organizations',
        'Organization admins insert memberships',
        'Organization admins update memberships',
        'Organization admins delete memberships'
      ))
    OR (tablename = 'organization_resolution_keys'
      AND policyname = 'Organization admins manage resolution keys')
    OR (tablename IN ('customers', 'properties', 'quotes', 'bookings')
      AND policyname = 'Tenant boundary ' || tablename)
  );

SELECT count(*) AS lineage_trigger_count
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN (
    'enforce_bookings_organization_lineage',
    'enforce_quotes_organization_lineage'
  );

SELECT count(*) AS provenance_guard_trigger_count
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'tenant_security'
  AND c.relname = 'release_provenance'
  AND t.tgname = 'release_provenance_append_only';

SELECT
  has_schema_privilege('anon', 'tenant_security', 'USAGE')
    AS anon_has_tenant_security_usage,
  has_schema_privilege('service_role', 'tenant_security', 'USAGE')
    AS service_role_has_tenant_security_usage,
  has_function_privilege(
    'anon',
    'tenant_security.current_organization_role(uuid)',
    'EXECUTE'
  ) AS anon_can_execute_resolver,
  has_function_privilege(
    'service_role',
    'tenant_security.current_organization_role(uuid)',
    'EXECUTE'
  ) AS service_role_can_execute_resolver,
  has_function_privilege(
    'authenticated',
    'tenant_security.current_organization_role(uuid)',
    'EXECUTE'
  ) AS authenticated_can_execute_resolver,
  has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'SELECT'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'INSERT'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'UPDATE'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'DELETE'
  ) AS authenticated_has_membership_grants;

SELECT
  jobid,
  schedule,
  active,
  md5(command) AS command_fingerprint
FROM cron.job
WHERE jobid IN (3, 5, 6)
ORDER BY jobid;

-- Fail closed unless every signed postflight invariant is present.
SELECT 1 / CASE WHEN (
  SELECT count(*) = 145
    AND max(version) = '20260726194719'
    AND md5(string_agg(version || ':' || name, '|' ORDER BY version))
      = '73ed8522db78e51049a421e1f72b18c3'
    AND count(*) FILTER (WHERE version = '20260728060000') = 0
  FROM supabase_migrations.schema_migrations
) THEN 1 ELSE 0 END AS ledger_unchanged_asserted;

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM public.customers WHERE organization_id IS NULL) = 0
  AND (SELECT count(*) FROM public.properties WHERE organization_id IS NULL) = 0
  AND (SELECT count(*) FROM public.quotes WHERE organization_id IS NULL) = 0
  AND (SELECT count(*) FROM public.bookings WHERE organization_id IS NULL) = 0
  AND (
    SELECT count(*)
    FROM public.quotes q
    JOIN public.customers c ON c.id = q.customer_id
    WHERE q.organization_id IS DISTINCT FROM c.organization_id
  ) = 0
  AND (
    SELECT count(*)
    FROM public.bookings b
    JOIN public.customers c ON c.id = b.customer_id
    WHERE b.organization_id IS DISTINCT FROM c.organization_id
  ) = 0
  THEN 1 ELSE 0 END AS first_wave_backfill_asserted;

SELECT 1 / CASE WHEN
  (
    SELECT count(*)
    FROM pg_constraint
    WHERE convalidated
      AND conname IN (
        'customers_organization_id_fkey',
        'properties_organization_id_fkey',
        'quotes_organization_id_fkey',
        'bookings_organization_id_fkey'
      )
  ) = 4
  AND (
    SELECT count(*)
    FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND is_legacy_default
      AND status = 'active'
  ) = 1
  AND (
    SELECT count(*)
    FROM public.organizations
    WHERE slug ILIKE '%oregon%' AND status = 'active'
  ) = 0
  THEN 1 ELSE 0 END AS tenant_foundation_asserted;

SELECT 1 / CASE WHEN (
  SELECT count(*) = 1
  FROM tenant_security.release_provenance
  WHERE release_id = 'tenant-foundation-stage-7b-lovable-v1'
    AND artifact_sha256 = '8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e'
    AND project_ref = 'gyndziiuizpgwhqwyrvn'
    AND environment = 'Live/production'
    AND transaction_outcome = 'committed'
) THEN 1 ELSE 0 END AS atomic_provenance_asserted;

SELECT 1 / CASE WHEN
  NOT has_table_privilege(
    'anon',
    'tenant_security.release_provenance',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'tenant_security.release_provenance',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'anon',
    'tenant_security.release_provenance',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'anon',
    'tenant_security.release_provenance',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'DELETE'
  )
  AND NOT has_schema_privilege('anon', 'tenant_security', 'USAGE')
  AND NOT has_schema_privilege('service_role', 'tenant_security', 'USAGE')
  AND (
    SELECT count(*) = 3
      AND bool_and(
        p.prosecdef
        AND p.proowner = 'postgres'::regrole
        AND p.proconfig @> ARRAY['search_path=pg_catalog']
      )
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'tenant_security'
      AND p.proname IN (
        'is_platform_organization_admin',
        'current_organization_role',
        'can_manage_membership_role'
      )
  )
  AND (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (tablename = 'organizations'
          AND policyname = 'Members can view active organizations')
        OR (tablename = 'organization_memberships'
          AND policyname IN (
            'Members can view memberships in their organizations',
            'Organization admins insert memberships',
            'Organization admins update memberships',
            'Organization admins delete memberships'
          ))
        OR (tablename = 'organization_resolution_keys'
          AND policyname = 'Organization admins manage resolution keys')
        OR (tablename IN ('customers', 'properties', 'quotes', 'bookings')
          AND policyname = 'Tenant boundary ' || tablename)
      )
  ) = 10
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'SELECT'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'INSERT'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'UPDATE'
  )
  AND has_table_privilege(
    'authenticated',
    'public.organization_memberships',
    'DELETE'
  )
  THEN 1 ELSE 0 END AS security_correction_asserted;

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM cron.job WHERE jobid IN (3, 5, 6)) = 3
  AND (
    SELECT bool_and(
      CASE jobid
        WHEN 3 THEN md5(command) = '1a1b5b332626f37867e3521d2052f56b'
        WHEN 5 THEN md5(command) = '88e143e3876903e839e7551f68dd179b'
        WHEN 6 THEN md5(command) = 'ad8c290523e2659a608e7fcb7d57bcb7'
        ELSE false
      END
    )
    FROM cron.job
    WHERE jobid IN (3, 5, 6)
  )
  THEN 1 ELSE 0 END AS cron_fingerprints_asserted;

ROLLBACK;
