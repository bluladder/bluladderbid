-- Read-only hosted preflight for BluLadder Klamath public contact authority.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH prerequisites AS (
  SELECT count(*) FILTER (
    WHERE to_regclass('public.' || required_table) IS NOT NULL
  ) AS prerequisite_table_count
  FROM unnest(ARRAY[
    'organizations',
    'organization_memberships',
    'organization_customer_sites',
    'organization_contacts'
  ]) AS required_tables(required_table)
),
target_state AS (
  SELECT count(*) FILTER (
    WHERE to_regclass('public.' || target_table) IS NOT NULL
  ) AS target_table_count
  FROM unnest(ARRAY[
    'organization_public_contacts'
  ]) AS target_tables(target_table)
),
organization_state AS (
  SELECT
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true
    ) AS exact_dfw_default_count,
    count(*) FILTER (
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
    ) AS unexpected_legacy_default_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false
    ) AS exact_klamath_provisioning_count
  FROM public.organizations
),
klamath_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id =
          'b1addf00-0000-4000-8000-000000000003'::uuid
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'provisioning'
        AND runtime_routing_enabled = false
        AND site_published = false
        AND customer_traffic_allowed = false)
      AS exact_inactive_site_count,
    (SELECT count(*) FROM public.organization_contacts
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS internal_contact_count,
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS membership_count
)
SELECT jsonb_build_object(
  'prerequisite_table_count', prerequisites.prerequisite_table_count,
  'target_table_count', target_state.target_table_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'exact_inactive_site_count', klamath_state.exact_inactive_site_count,
  'internal_contact_count', klamath_state.internal_contact_count,
  'membership_count', klamath_state.membership_count
) AS public_contact_preflight
FROM prerequisites, target_state, organization_state, klamath_state;

ROLLBACK;
