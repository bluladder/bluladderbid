-- Read-only hosted preflight for BluLadder Klamath Phase 1I CRM connector
-- lineage. This file performs no DDL, DML, credential access, provider action,
-- or migration-ledger mutation.

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
    'organization_resolution_keys',
    'customers',
    'chat_conversations',
    'bookings'
  ]) AS required_tables(required_table)
),
target_state AS (
  SELECT count(*) FILTER (
    WHERE to_regclass('public.' || target_table) IS NOT NULL
  ) AS target_table_count
  FROM unnest(ARRAY[
    'organization_crm_connectors',
    'organization_connector_operation_attempts',
    'organization_connector_webhook_receipts'
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
  'prerequisite_table_count', prerequisites.prerequisite_table_count,
  'target_table_count', target_state.target_table_count,
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
) AS phase_1i_preflight
FROM prerequisites, target_state, organization_state, klamath_state;

ROLLBACK;
