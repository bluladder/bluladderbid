-- Read-only postflight for the Phase 1I authenticated-role grant repair.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH authenticated_grants AS (
  SELECT table_name,
    array_agg(privilege_type::text ORDER BY privilege_type::text)
      AS privileges
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
    AND grantee = 'authenticated'
  GROUP BY table_name
), excess_grants AS (
  SELECT count(*) AS excess_privilege_count
  FROM unnest(ARRAY[
    'organization_crm_connectors',
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
  ]) AS target_tables(target_table)
  CROSS JOIN unnest(ARRAY['REFERENCES', 'TRIGGER', 'TRUNCATE'])
    AS privileges(privilege_name)
  WHERE has_table_privilege(
    'authenticated', format('public.%I', target_table), privilege_name
  )
), role_grants AS (
  SELECT
    count(*) FILTER (WHERE grantee = 'anon') AS anon_grant_count,
    count(*) FILTER (WHERE grantee = 'service_role')
      AS service_role_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
    AND grantee IN ('anon', 'service_role')
), security_state AS (
  SELECT
    count(*) FILTER (WHERE relation.relrowsecurity)
      AS rls_enabled_table_count,
    count(policy.policyname) FILTER (
      WHERE relation.relname = 'organization_crm_connectors'
    ) AS connector_policy_count,
    count(policy.policyname) FILTER (
      WHERE relation.relname = 'organization_connector_operation_attempts'
    ) AS operation_policy_count,
    count(policy.policyname) FILTER (
      WHERE relation.relname = 'organization_connector_webhook_receipts'
    ) AS webhook_policy_count
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_policies policy
    ON policy.schemaname = namespace.nspname
    AND policy.tablename = relation.relname
  WHERE namespace.nspname = 'public'
    AND relation.relname IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
), row_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_crm_connectors)
      AS connector_count,
    (SELECT count(*) FROM public.organization_connector_operation_attempts)
      AS operation_attempt_count,
    (SELECT count(*) FROM public.organization_connector_webhook_receipts)
      AS webhook_receipt_count
), organization_state AS (
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
), klamath_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS membership_count,
    (SELECT count(*) FROM public.customers
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS customer_count,
    (SELECT count(*) FROM public.chat_conversations
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS conversation_count,
    (SELECT count(*) FROM public.bookings
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS booking_count,
    (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid
        AND key_type IN (
          'jobber_account', 'jobtread_account', 'google_calendar',
          'callrail_number', 'twilio_number', 'vapi_assistant',
          'vapi_phone_number'
        )) AS provider_identity_count
)
SELECT jsonb_build_object(
  'authenticated_grants', (SELECT jsonb_agg(
    jsonb_build_object('table_name', table_name, 'privileges', privileges)
    ORDER BY table_name
  ) FROM authenticated_grants),
  'authenticated_excess_privilege_count',
    excess_grants.excess_privilege_count,
  'anon_grant_count', role_grants.anon_grant_count,
  'service_role_grant_count', role_grants.service_role_grant_count,
  'rls_enabled_table_count', security_state.rls_enabled_table_count,
  'connector_policy_count', security_state.connector_policy_count,
  'operation_policy_count', security_state.operation_policy_count,
  'webhook_policy_count', security_state.webhook_policy_count,
  'connector_count', row_state.connector_count,
  'operation_attempt_count', row_state.operation_attempt_count,
  'webhook_receipt_count', row_state.webhook_receipt_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'klamath_membership_count', klamath_state.membership_count,
  'klamath_customer_count', klamath_state.customer_count,
  'klamath_conversation_count', klamath_state.conversation_count,
  'klamath_booking_count', klamath_state.booking_count,
  'klamath_provider_identity_count', klamath_state.provider_identity_count
) AS phase_1i_grant_postflight
FROM excess_grants, role_grants, security_state, row_state,
  organization_state, klamath_state;

ROLLBACK;
