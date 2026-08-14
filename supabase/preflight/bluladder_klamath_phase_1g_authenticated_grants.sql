BEGIN TRANSACTION READ ONLY;

SELECT jsonb_build_object(
  'connector_table_count', (
    SELECT count(*) FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'organization_messaging_connectors'
      AND c.relkind = 'r'
  ),
  'rls_enabled', (
    SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.organization_messaging_connectors'::regclass
  ),
  'policy_count', (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'organization_messaging_connectors'
  ),
  'authenticated_privileges', (
    SELECT jsonb_agg(privilege_type ORDER BY privilege_type)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_messaging_connectors'
      AND grantee = 'authenticated'
  ),
  'anon_privilege_count', (
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_messaging_connectors'
      AND grantee = 'anon'
  ),
  'service_role_privilege_count', (
    SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = 'organization_messaging_connectors'
      AND grantee = 'service_role'
  ),
  'connector_count', (
    SELECT count(*) FROM public.organization_messaging_connectors
  ),
  'sms_message_count', (SELECT count(*) FROM public.sms_messages),
  'missing_organization_count', (
    SELECT count(*) FROM public.sms_messages WHERE organization_id IS NULL
  ),
  'non_dfw_count', (
    SELECT count(*) FROM public.sms_messages
    WHERE organization_id <>
      'b1addf00-0000-4000-8000-000000000001'::uuid
  ),
  'connector_bound_count', (
    SELECT count(*) FROM public.sms_messages
    WHERE messaging_connector_id IS NOT NULL
  ),
  'klamath_provisioning_count', (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath'
      AND status = 'provisioning'
      AND is_legacy_default = false
  ),
  'klamath_active_count', (
    SELECT count(*) FROM public.organizations
    WHERE slug = 'bluladder-klamath' AND status = 'active'
  )
) AS phase_1g_grant_preflight;

ROLLBACK;
