-- Read-only postflight for BluLadder Klamath Phase 1I CRM connector lineage.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH target_tables AS (
  SELECT count(*) FILTER (
    WHERE to_regclass('public.' || target_table) IS NOT NULL
  ) AS target_table_count
  FROM unnest(ARRAY[
    'organization_crm_connectors',
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
  ]) AS target_tables(target_table)
),
row_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_crm_connectors)
      AS connector_count,
    (SELECT count(*) FROM public.organization_connector_operation_attempts)
      AS operation_attempt_count,
    (SELECT count(*) FROM public.organization_connector_webhook_receipts)
      AS webhook_receipt_count
),
security_state AS (
  SELECT
    count(*) FILTER (WHERE relrowsecurity) AS rls_enabled_table_count,
    count(*) FILTER (
      WHERE relname = 'organization_crm_connectors'
    ) AS connector_rel_count,
    count(*) FILTER (
      WHERE relname = 'organization_connector_operation_attempts'
    ) AS operation_rel_count,
    count(*) FILTER (
      WHERE relname = 'organization_connector_webhook_receipts'
    ) AS webhook_rel_count
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND relname IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
),
policy_state AS (
  SELECT
    count(*) FILTER (
      WHERE tablename = 'organization_crm_connectors'
    ) AS connector_policy_count,
    count(*) FILTER (
      WHERE tablename = 'organization_connector_operation_attempts'
    ) AS operation_policy_count,
    count(*) FILTER (
      WHERE tablename = 'organization_connector_webhook_receipts'
    ) AS webhook_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
),
grant_state AS (
  SELECT
    count(*) FILTER (WHERE grantee = 'anon') AS anon_grant_count,
    count(*) FILTER (
      WHERE grantee = 'authenticated'
        AND table_name = 'organization_crm_connectors'
    ) AS authenticated_connector_grant_count,
    count(*) FILTER (
      WHERE grantee = 'authenticated'
        AND table_name = 'organization_connector_operation_attempts'
    ) AS authenticated_operation_grant_count,
    count(*) FILTER (
      WHERE grantee = 'authenticated'
        AND table_name = 'organization_connector_webhook_receipts'
    ) AS authenticated_webhook_grant_count,
    count(*) FILTER (WHERE grantee = 'service_role')
      AS service_role_grant_count
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND table_name IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
),
index_state AS (
  SELECT count(*) AS expected_index_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN (
      'organization_crm_connectors_selection_idx',
      'organization_connector_operation_attempts_org_status_idx',
      'organization_connector_operation_attempts_connector_idx',
      'organization_connector_webhook_receipts_org_status_idx',
      'organization_connector_webhook_receipts_connector_idx'
    )
),
forbidden_columns AS (
  SELECT count(*) AS forbidden_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'organization_crm_connectors',
      'organization_connector_operation_attempts',
      'organization_connector_webhook_receipts'
    )
    AND column_name IN (
      'credential', 'secret', 'token', 'headers', 'request_body',
      'response_body', 'payload', 'customer_data', 'provider_organization_id',
      'provider_event_id'
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
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_membership_count,
    (SELECT count(*) FROM public.customers
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_customer_count,
    (SELECT count(*) FROM public.chat_conversations
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_conversation_count,
    (SELECT count(*) FROM public.bookings
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_booking_count,
    (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid
        AND key_type IN (
          'jobber_account', 'jobtread_account', 'google_calendar',
          'callrail_number', 'twilio_number', 'vapi_assistant',
          'vapi_phone_number'
        )) AS klamath_provider_identity_count
)
SELECT jsonb_build_object(
  'target_table_count', target_tables.target_table_count,
  'connector_count', row_state.connector_count,
  'operation_attempt_count', row_state.operation_attempt_count,
  'webhook_receipt_count', row_state.webhook_receipt_count,
  'rls_enabled_table_count', security_state.rls_enabled_table_count,
  'connector_rel_count', security_state.connector_rel_count,
  'operation_rel_count', security_state.operation_rel_count,
  'webhook_rel_count', security_state.webhook_rel_count,
  'connector_policy_count', policy_state.connector_policy_count,
  'operation_policy_count', policy_state.operation_policy_count,
  'webhook_policy_count', policy_state.webhook_policy_count,
  'anon_grant_count', grant_state.anon_grant_count,
  'authenticated_connector_grant_count',
    grant_state.authenticated_connector_grant_count,
  'authenticated_operation_grant_count',
    grant_state.authenticated_operation_grant_count,
  'authenticated_webhook_grant_count',
    grant_state.authenticated_webhook_grant_count,
  'service_role_grant_count', grant_state.service_role_grant_count,
  'expected_index_count', index_state.expected_index_count,
  'forbidden_column_count', forbidden_columns.forbidden_column_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'klamath_membership_count', klamath_state.klamath_membership_count,
  'klamath_customer_count', klamath_state.klamath_customer_count,
  'klamath_conversation_count', klamath_state.klamath_conversation_count,
  'klamath_booking_count', klamath_state.klamath_booking_count,
  'klamath_provider_identity_count',
    klamath_state.klamath_provider_identity_count
) AS phase_1i_postflight
FROM target_tables, row_state, security_state, policy_state, grant_state,
  index_state, forbidden_columns, organization_state, klamath_state;

ROLLBACK;
