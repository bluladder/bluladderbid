-- Read-only hosted preflight for split Klamath public call/text channels.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH target_state AS (
  SELECT
    count(*) AS target_table_count,
    count(*) FILTER (WHERE relrowsecurity) AS rls_enabled_table_count
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND relname = 'organization_public_contacts'
),
row_state AS (
  SELECT
    count(*) AS public_contact_count,
    count(*) FILTER (WHERE status = 'published') AS published_contact_count
  FROM public.organization_public_contacts
),
constraint_state AS (
  SELECT
    count(*) FILTER (
      WHERE conname = 'organization_public_contacts_channel_check'
        AND convalidated
        AND position('phone' IN pg_get_constraintdef(oid)) > 0
        AND position('email' IN pg_get_constraintdef(oid)) > 0
        AND position('sms' IN pg_get_constraintdef(oid)) = 0
    ) AS current_channel_constraint_count,
    count(*) FILTER (
      WHERE conname = 'organization_public_contacts_destination_check'
        AND convalidated
        AND position('phone' IN pg_get_constraintdef(oid)) > 0
        AND position('email' IN pg_get_constraintdef(oid)) > 0
        AND position('sms' IN pg_get_constraintdef(oid)) = 0
    ) AS current_destination_constraint_count
  FROM pg_constraint
  WHERE conrelid = 'public.organization_public_contacts'::regclass
),
policy_state AS (
  SELECT count(*) AS policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'organization_public_contacts'
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
site_state AS (
  SELECT count(*) AS exact_inactive_site_count
  FROM public.organization_customer_sites
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    AND tenant_key = 'bluladder-klamath'
    AND canonical_hostname = 'klamath.bluladder.com'
    AND mapping_status = 'provisioning'
    AND runtime_routing_enabled = false
    AND site_published = false
    AND customer_traffic_allowed = false
)
SELECT jsonb_build_object(
  'target_table_count', target_state.target_table_count,
  'rls_enabled_table_count', target_state.rls_enabled_table_count,
  'public_contact_count', row_state.public_contact_count,
  'published_contact_count', row_state.published_contact_count,
  'current_channel_constraint_count',
    constraint_state.current_channel_constraint_count,
  'current_destination_constraint_count',
    constraint_state.current_destination_constraint_count,
  'policy_count', policy_state.policy_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'exact_inactive_site_count', site_state.exact_inactive_site_count
) AS split_public_contact_preflight
FROM target_state, row_state, constraint_state, policy_state,
  organization_state, site_state;

ROLLBACK;
