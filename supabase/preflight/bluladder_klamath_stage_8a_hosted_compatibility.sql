-- Read-only preflight for the forward Stage 8A hosted-compatibility migration.
-- This inspects only non-PII tenant/schema state and performs no mutation.

BEGIN TRANSACTION READ ONLY;

-- All three rows must report present=true.
SELECT required_table, to_regclass('public.' || required_table) IS NOT NULL AS present
FROM unnest(ARRAY[
  'organizations',
  'organization_memberships',
  'organization_resolution_keys'
]) AS required_table
ORDER BY required_table;

-- Must report false. The compatibility payload never recreates this retired
-- public SECURITY DEFINER helper.
SELECT to_regprocedure('public.is_organization_member(uuid,uuid)') IS NOT NULL
  AS obsolete_public_membership_helper_present;

-- Both function prerequisites must return true.
SELECT
  to_regprocedure('auth.uid()') IS NOT NULL AS auth_uid_present,
  to_regprocedure('gen_random_uuid()') IS NOT NULL
    AS random_uuid_generator_present;

-- Production hosted preflight must report 0. A compatible rebuild may report
-- 4; every partial count is a hard stop.
SELECT count(*) AS existing_stage_8a_target_table_count
FROM unnest(ARRAY[
  'organization_settings',
  'organization_contacts',
  'organization_territories',
  'organization_services'
]) AS target_table
WHERE to_regclass('public.' || target_table) IS NOT NULL;

-- Must return 1 / 0 for the established DFW baseline.
SELECT
  count(*) FILTER (
    WHERE id = 'b1addf00-0000-4000-8000-000000000001'
      AND slug = 'bluladder-dfw'
      AND display_name = 'BluLadder DFW'
      AND status = 'active'
      AND is_legacy_default = true
  ) AS exact_dfw_count,
  count(*) FILTER (
    WHERE is_legacy_default = true
      AND id <> 'b1addf00-0000-4000-8000-000000000001'
  ) AS unexpected_legacy_default_count
FROM public.organizations;

-- Both counts must be zero in the current hosted-missing mode.
SELECT
  count(*) FILTER (
    WHERE id = 'b1addf00-0000-4000-8000-000000000002'
  ) AS oregon_test_id_count,
  count(*) FILTER (
    WHERE lower(slug) = 'bluladder-oregon-test'
  ) AS oregon_test_slug_count
FROM public.organizations;

ROLLBACK;
