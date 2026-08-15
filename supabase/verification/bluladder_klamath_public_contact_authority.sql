-- Read-only postflight for BluLadder Klamath public contact authority.

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
policy_state AS (
  SELECT
    count(*) AS policy_count,
    count(*) FILTER (
      WHERE policyname = 'Tenant operators view public contacts'
        AND cmd = 'SELECT'
    ) AS exact_view_policy_count,
    count(*) FILTER (
      WHERE policyname = 'Tenant owners manage public contacts'
        AND cmd = 'ALL'
    ) AS exact_manage_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'organization_public_contacts'
),
grant_state AS (
  SELECT
    count(*) FILTER (WHERE grantee = 'anon') AS anon_grant_count,
    count(*) FILTER (WHERE grantee = 'authenticated')
      AS authenticated_grant_count,
    count(*) FILTER (WHERE grantee = 'service_role')
      AS service_role_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name = 'organization_public_contacts'
),
index_state AS (
  SELECT count(*) AS expected_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'organization_public_contacts_lookup_idx',
      'organization_public_contacts_one_published_channel_idx'
    )
),
column_state AS (
  SELECT count(*) AS expected_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'organization_public_contacts'
    AND column_name IN (
      'id', 'organization_id', 'channel', 'label', 'destination', 'status',
      'owner_approved_at', 'owner_approval_reference_hash', 'verified_at',
      'published_at', 'configuration_version', 'created_at', 'updated_at'
    )
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
  'target_table_count', target_state.target_table_count,
  'rls_enabled_table_count', target_state.rls_enabled_table_count,
  'public_contact_count', row_state.public_contact_count,
  'published_contact_count', row_state.published_contact_count,
  'policy_count', policy_state.policy_count,
  'exact_view_policy_count', policy_state.exact_view_policy_count,
  'exact_manage_policy_count', policy_state.exact_manage_policy_count,
  'anon_grant_count', grant_state.anon_grant_count,
  'authenticated_grant_count', grant_state.authenticated_grant_count,
  'service_role_grant_count', grant_state.service_role_grant_count,
  'expected_index_count', index_state.expected_index_count,
  'expected_column_count', column_state.expected_column_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'exact_inactive_site_count', klamath_state.exact_inactive_site_count,
  'internal_contact_count', klamath_state.internal_contact_count,
  'membership_count', klamath_state.membership_count
) AS public_contact_postflight
FROM target_state, row_state, policy_state, grant_state, index_state,
  column_state, organization_state, klamath_state;

ROLLBACK;
