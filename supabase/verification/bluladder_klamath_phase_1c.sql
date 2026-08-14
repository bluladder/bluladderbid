-- Read-only postflight for BluLadder Klamath Phase 1C.
-- Every query returns non-PII configuration counts/statuses only.

BEGIN TRANSACTION READ ONLY;

-- Exactly one provisioning, non-default Klamath organization.
SELECT count(*) AS exact_provisioning_organization_count
FROM public.organizations
WHERE id = 'b1addf00-0000-4000-8000-000000000003'
  AND slug = 'bluladder-klamath'
  AND display_name = 'BluLadder Klamath'
  AND status = 'provisioning'
  AND is_legacy_default = false;

-- Exactly one unpublished, disabled-for-traffic site.
SELECT count(*) AS exact_inactive_site_count
FROM public.organization_customer_sites
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'
  AND tenant_key = 'bluladder-klamath'
  AND canonical_hostname = 'klamath.bluladder.com'
  AND mapping_status = 'provisioning'
  AND runtime_routing_enabled = false
  AND site_published = false
  AND customer_traffic_allowed = false;

-- Exactly one disabled hostname identity; zero provider identities.
SELECT
  count(*) FILTER (
    WHERE key_type = 'hostname' AND status = 'disabled'
  ) AS disabled_hostname_count,
  count(*) FILTER (
    WHERE key_type IN (
      'jobber_account', 'callrail_number', 'email_address',
      'vapi_assistant', 'vapi_phone_number'
    )
  ) AS provider_identity_count
FROM public.organization_resolution_keys
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003';

-- Exactly two inactive include counties and no active territory.
SELECT
  count(*) AS territory_count,
  count(*) FILTER (WHERE status = 'active') AS active_territory_count,
  count(*) FILTER (
    WHERE status = 'inactive'
      AND effect = 'include'
      AND state_code = 'OR'
      AND county_name IN ('Klamath', 'Lake')
  ) AS exact_inactive_county_count
FROM public.organization_territories
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003';

-- Exactly six inactive/manual-review services and no available service.
SELECT
  count(*) AS service_count,
  count(*) FILTER (
    WHERE status = 'inactive' AND availability = 'manual_review'
  ) AS inactive_manual_review_count,
  count(*) FILTER (
    WHERE status = 'active' OR availability = 'available'
  ) AS active_or_available_count
FROM public.organization_services
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003';

-- Exactly one draft, runtime-disabled pricing snapshot.
SELECT
  count(*) AS pricing_profile_count,
  count(*) FILTER (
    WHERE profile_key = 'bluladder-klamath-pricing-draft'
      AND version = 1
      AND status = 'draft'
      AND runtime_enabled = false
      AND jsonb_typeof(config_snapshot) = 'object'
  ) AS exact_draft_pricing_count,
  count(*) FILTER (WHERE runtime_enabled) AS runtime_pricing_count
FROM public.organization_pricing_profiles
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003';

-- All must be zero: no person, destination, or customer/provider activation.
SELECT
  (SELECT count(*) FROM public.organization_memberships
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS membership_count,
  (SELECT count(*) FROM public.organization_contacts
    WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS contact_count;

-- Exactly two RLS policies per new table, with RLS enabled.
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
    'organization_customer_sites',
    'organization_pricing_profiles'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

-- Authenticated must have exactly CRUD, anonymous none, and service role all.
SELECT
  grantee,
  table_name,
  array_agg(privilege_type::text ORDER BY privilege_type::text) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'organization_customer_sites',
    'organization_pricing_profiles'
  )
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

-- All six rows must report false.
SELECT
  target_table,
  privilege_name,
  has_table_privilege(
    'authenticated',
    format('public.%I', target_table),
    privilege_name
  ) AS retained
FROM unnest(ARRAY[
  'organization_customer_sites',
  'organization_pricing_profiles'
]) AS target_tables(target_table)
CROSS JOIN unnest(ARRAY[
  'REFERENCES', 'TRIGGER', 'TRUNCATE'
]) AS privileges(privilege_name)
ORDER BY target_table, privilege_name;

ROLLBACK;
