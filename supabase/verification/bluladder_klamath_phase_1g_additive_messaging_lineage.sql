BEGIN TRANSACTION READ ONLY;

SELECT
  (to_regclass('public.organization_messaging_connectors') IS NOT NULL)::int
    AS connector_table_count,
  count(*) AS connector_count
FROM public.organization_messaging_connectors;

SELECT
  count(*) FILTER (WHERE column_name = 'organization_id')
    AS organization_column_count,
  count(*) FILTER (WHERE column_name = 'messaging_connector_id')
    AS connector_column_count,
  count(*) FILTER (
    WHERE column_name = 'organization_id' AND is_nullable = 'YES'
  ) AS nullable_organization_column_count,
  count(*) FILTER (
    WHERE column_name = 'messaging_connector_id' AND is_nullable = 'YES'
  ) AS nullable_connector_column_count
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'sms_messages';

SELECT
  count(*) AS sms_message_count,
  count(*) FILTER (WHERE organization_id IS NULL) AS missing_organization_count,
  count(*) FILTER (
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) AS non_dfw_historical_count,
  count(*) FILTER (WHERE messaging_connector_id IS NOT NULL)
    AS connector_bound_count
FROM public.sms_messages;

SELECT
  count(*) FILTER (WHERE relrowsecurity) AS rls_enabled_table_count
FROM pg_class
WHERE oid = 'public.organization_messaging_connectors'::regclass;

SELECT count(*) AS connector_policy_count
FROM pg_policy
WHERE polrelid = 'public.organization_messaging_connectors'::regclass;

SELECT policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_messaging_connectors'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'organization_messaging_connectors'
  AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;

SELECT
  count(*) FILTER (
    WHERE conname = 'sms_messages_organization_id_fkey'
  ) AS organization_fk_count,
  count(*) FILTER (
    WHERE conname = 'sms_messages_messaging_connector_id_fkey'
  ) AS connector_fk_count
FROM pg_constraint
WHERE conrelid = 'public.sms_messages'::regclass;

SELECT count(*) AS lineage_trigger_count
FROM pg_trigger
WHERE tgrelid = 'public.sms_messages'::regclass
  AND tgname = 'enforce_sms_message_organization_lineage'
  AND NOT tgisinternal;

SELECT
  has_function_privilege(
    'anon', 'public.enforce_sms_message_organization_lineage()', 'EXECUTE'
  )::int AS anon_execute_count,
  has_function_privilege(
    'authenticated',
    'public.enforce_sms_message_organization_lineage()',
    'EXECUTE'
  )::int AS authenticated_execute_count,
  has_function_privilege(
    'service_role',
    'public.enforce_sms_message_organization_lineage()',
    'EXECUTE'
  )::int AS service_role_execute_count;

SELECT
  count(*) FILTER (
    WHERE slug = 'bluladder-klamath' AND status = 'provisioning'
  ) AS klamath_provisioning_count,
  count(*) FILTER (
    WHERE slug = 'bluladder-klamath' AND status = 'active'
  ) AS klamath_active_count
FROM public.organizations;

ROLLBACK;
