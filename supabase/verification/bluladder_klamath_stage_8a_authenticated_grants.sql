-- Read-only postflight for the Stage 8A authenticated-role grant repair.
-- This exposes only schema, role, and non-PII tenant-configuration evidence.

BEGIN TRANSACTION READ ONLY;

-- Every authenticated row must contain exactly CRUD privileges.
SELECT
  table_name,
  array_agg(privilege_type::text ORDER BY privilege_type::text)
    AS authenticated_privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
  AND grantee = 'authenticated'
GROUP BY table_name
ORDER BY table_name;

-- Must return zero for every table and excess privilege.
SELECT
  target_table,
  privilege_name,
  has_table_privilege(
    'authenticated',
    format('public.%I', target_table),
    privilege_name
  ) AS retained
FROM unnest(ARRAY[
  'organization_settings',
  'organization_contacts',
  'organization_territories',
  'organization_services'
]) AS target_tables(target_table)
CROSS JOIN unnest(ARRAY[
  'REFERENCES', 'TRIGGER', 'TRUNCATE'
]) AS privileges(privilege_name)
ORDER BY target_table, privilege_name;

-- Must return zero anonymous grants and 28 service-role grants.
SELECT
  count(*) FILTER (WHERE grantee = 'anon') AS anonymous_grant_count,
  count(*) FILTER (WHERE grantee = 'service_role') AS service_role_grant_count
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
  AND grantee IN ('anon', 'service_role');

-- Must remain false/zero: no helper or Phase 1C/Klamath state.
SELECT
  to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL
    AS retired_helper_present,
  to_regclass('public.organization_customer_sites') IS NOT NULL
    AS phase1c_sites_table_present,
  to_regclass('public.organization_pricing_profiles') IS NOT NULL
    AS phase1c_pricing_table_present,
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000003'
       OR lower(slug) = 'bluladder-klamath') AS klamath_organization_count;

-- Must return 1/1/1 and zero activation surfaces.
SELECT
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND status = 'active'
      AND is_legacy_default = true) AS exact_dfw_count,
  (SELECT count(*) FROM public.organization_settings
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000001'
      AND public_name = 'BluLadder DFW'
      AND timezone = 'America/Chicago') AS exact_dfw_settings_count,
  (SELECT count(*) FROM public.organizations
    WHERE id = 'b1addf00-0000-4000-8000-000000000002'
      AND slug = 'bluladder-oregon-test'
      AND status = 'provisioning'
      AND is_legacy_default = false) AS exact_oregon_test_count,
  (SELECT count(*) FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS oregon_contact_count,
  (SELECT count(*) FROM public.organization_services
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS oregon_service_count,
  (SELECT count(*) FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS oregon_membership_count,
  (SELECT count(*) FROM public.organization_resolution_keys
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000002')
    AS oregon_resolution_key_count;

ROLLBACK;
