-- Read-only postflight for the forward Stage 8A hosted-compatibility migration.
-- Every query returns schema or non-PII tenant-configuration evidence only.

BEGIN TRANSACTION READ ONLY;

-- Must return four rows, each with RLS enabled and exactly two policies.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  count(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
  ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- Must return false / zero. Policies use direct tenant-membership predicates.
SELECT
  to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL
    AS obsolete_public_membership_helper_present,
  count(*) FILTER (
    WHERE qual ILIKE '%is_organization_member%'
       OR with_check ILIKE '%is_organization_member%'
  ) AS obsolete_helper_policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  );

-- Must return exactly one unchanged DFW organization and one exact settings
-- row. No contact, customer, credential, or provider value is selected.
SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND display_name = 'BluLadder DFW'
      AND status = 'active'
      AND is_legacy_default = true) AS exact_dfw_count,
  (SELECT count(*) FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public_name = 'BluLadder DFW'
      AND timezone = 'America/Chicago'
      AND locale = 'en-US'
      AND currency_code = 'USD') AS exact_dfw_settings_count;

-- Must return 1 / 1 / 1 for the inactive Oregon schema fixture.
SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000002'
      AND slug = 'bluladder-oregon-test'
      AND display_name = 'BluLadder Oregon Test'
      AND status = 'provisioning'
      AND is_legacy_default = false) AS exact_oregon_test_count,
  (SELECT count(*) FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
      AND timezone = 'America/Los_Angeles'
      AND locale = 'en-US'
      AND currency_code = 'USD') AS exact_oregon_settings_count,
  (SELECT count(*) FROM public.organization_territories
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002'
      AND name = 'Oregon test fixture — inactive'
      AND state_code = 'OR'
      AND effect = 'include'
      AND priority = 100
      AND status = 'inactive') AS exact_inactive_territory_count;

-- Must be exactly one; no additional Oregon test territory is allowed.
SELECT count(*) AS total_oregon_test_territory_count
FROM public.organization_territories
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002';

-- Every activation-surface count must be zero.
SELECT
  (SELECT count(*) FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS contact_count,
  (SELECT count(*) FROM public.organization_services
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS service_count,
  (SELECT count(*) FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS membership_count,
  (SELECT count(*) FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS resolution_key_count;

ROLLBACK;
