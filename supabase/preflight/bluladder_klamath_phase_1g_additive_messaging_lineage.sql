BEGIN TRANSACTION READ ONLY;

WITH
prerequisites AS (
  SELECT count(*) FILTER (WHERE to_regclass('public.' || name) IS NOT NULL)
    AS prerequisite_table_count
  FROM unnest(ARRAY[
    'organizations', 'organization_memberships',
    'organization_resolution_keys', 'customers', 'quotes', 'bookings',
    'sms_messages'
  ]) AS name
),
target_state AS (
  SELECT
    (to_regclass('public.organization_messaging_connectors') IS NOT NULL)::int
      AS connector_table_count,
    count(*) FILTER (WHERE column_name = 'organization_id')
      AS organization_column_count,
    count(*) FILTER (WHERE column_name = 'messaging_connector_id')
      AS connector_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'sms_messages'
),
function_state AS (
  SELECT (
    to_regprocedure('public.enforce_sms_message_organization_lineage()')
      IS NOT NULL
  )::int AS lineage_function_count
),
organization_state AS (
  SELECT
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true
    ) AS dfw_exact_default_count,
    count(*) FILTER (
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'
    ) AS unexpected_default_count,
    count(*) FILTER (
      WHERE slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false
    ) AS klamath_provisioning_count
  FROM public.organizations
),
lineage AS (
  SELECT
    message.id,
    booking.organization_id AS booking_organization_id,
    quote.organization_id AS quote_organization_id,
    customer.organization_id AS customer_organization_id
  FROM public.sms_messages message
  LEFT JOIN public.bookings booking ON booking.id = message.booking_id
  LEFT JOIN public.quotes quote ON quote.id = message.quote_id
  LEFT JOIN public.customers customer ON customer.id = message.customer_id
),
sms_state AS (
  SELECT
    count(*) AS sms_message_count,
    count(*) FILTER (
      WHERE booking_organization_id IS NOT NULL
         OR quote_organization_id IS NOT NULL
         OR customer_organization_id IS NOT NULL
    ) AS parented_count,
    count(*) FILTER (
      WHERE booking_organization_id IS NULL
        AND quote_organization_id IS NULL
        AND customer_organization_id IS NULL
    ) AS unparented_count,
    count(*) FILTER (
      WHERE (booking_organization_id IS NOT NULL AND quote_organization_id IS NOT NULL
              AND booking_organization_id <> quote_organization_id)
         OR (booking_organization_id IS NOT NULL AND customer_organization_id IS NOT NULL
              AND booking_organization_id <> customer_organization_id)
         OR (quote_organization_id IS NOT NULL AND customer_organization_id IS NOT NULL
              AND quote_organization_id <> customer_organization_id)
    ) AS parent_conflict_count,
    count(*) FILTER (
      WHERE coalesce(
        booking_organization_id,
        quote_organization_id,
        customer_organization_id
      ) IS DISTINCT FROM 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND coalesce(
          booking_organization_id,
          quote_organization_id,
          customer_organization_id
        ) IS NOT NULL
    ) AS non_dfw_parent_count
  FROM lineage
),
klamath_state AS (
  SELECT
    (SELECT count(*) FROM public.customers customer
     JOIN public.organizations organization ON organization.id = customer.organization_id
     WHERE organization.slug = 'bluladder-klamath') AS klamath_customer_count,
    (SELECT count(*) FROM public.organization_resolution_keys key
     JOIN public.organizations organization ON organization.id = key.organization_id
     WHERE organization.slug = 'bluladder-klamath'
       AND key.key_type IN (
         'jobber_account', 'callrail_number', 'email_address',
         'vapi_assistant', 'vapi_phone_number'
       )) AS klamath_provider_identity_count
)
SELECT jsonb_build_object(
  'prerequisite_table_count', prerequisites.prerequisite_table_count,
  'connector_table_count', target_state.connector_table_count,
  'organization_column_count', target_state.organization_column_count,
  'connector_column_count', target_state.connector_column_count,
  'lineage_function_count', function_state.lineage_function_count,
  'dfw_exact_default_count', organization_state.dfw_exact_default_count,
  'unexpected_default_count', organization_state.unexpected_default_count,
  'klamath_provisioning_count', organization_state.klamath_provisioning_count,
  'sms_message_count', sms_state.sms_message_count,
  'parented_count', sms_state.parented_count,
  'unparented_count', sms_state.unparented_count,
  'parent_conflict_count', sms_state.parent_conflict_count,
  'non_dfw_parent_count', sms_state.non_dfw_parent_count,
  'klamath_customer_count', klamath_state.klamath_customer_count,
  'klamath_provider_identity_count', klamath_state.klamath_provider_identity_count
) AS phase_1g_preflight
FROM prerequisites, target_state, function_state, organization_state,
  sms_state, klamath_state;

ROLLBACK;
