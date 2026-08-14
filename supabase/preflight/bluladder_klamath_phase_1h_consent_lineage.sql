-- Read-only hosted preflight for BluLadder Klamath Phase 1H consent lineage.
-- This file performs no DDL, DML, credential access, provider action, or
-- migration-ledger mutation. It returns aggregate counts and non-PII state.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH prerequisites AS (
  SELECT count(*) FILTER (
    WHERE to_regclass('public.' || required_table) IS NOT NULL
  ) AS prerequisite_table_count
  FROM unnest(ARRAY[
    'organizations',
    'customers',
    'chat_conversations',
    'bookings',
    'communication_consent',
    'communication_consent_events'
  ]) AS required_tables(required_table)
),
target_state AS (
  SELECT
    count(*) FILTER (
      WHERE table_name = 'communication_consent'
        AND column_name = 'organization_id'
    ) AS consent_organization_column_count,
    count(*) FILTER (
      WHERE table_name = 'communication_consent_events'
        AND column_name = 'organization_id'
    ) AS event_organization_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN (
      'communication_consent',
      'communication_consent_events'
    )
),
function_state AS (
  SELECT
    (to_regprocedure(
      'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)'
    ) IS NOT NULL)::int AS organization_record_function_count,
    (to_regprocedure(
      'public.consent_allows_for_organization(uuid,public.consent_channel,public.consent_type,text,text)'
    ) IS NOT NULL)::int AS organization_allows_function_count,
    (to_regprocedure(
      'public.record_consent(public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)'
    ) IS NOT NULL)::int AS legacy_record_function_count,
    (to_regprocedure(
      'public.consent_allows(public.consent_channel,public.consent_type,text,text)'
    ) IS NOT NULL)::int AS legacy_allows_function_count
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
consent_lineage AS (
  SELECT
    consent.id,
    consent.channel,
    consent.consent_type,
    lower(nullif(trim(consent.email), '')) AS normalized_email,
    nullif(trim(consent.phone), '') AS normalized_phone,
    consent.customer_id,
    consent.conversation_id,
    consent.booking_id,
    customer.id AS joined_customer_id,
    customer.organization_id AS customer_organization_id,
    conversation.id AS joined_conversation_id,
    conversation.organization_id AS conversation_organization_id,
    booking.id AS joined_booking_id,
    booking.organization_id AS booking_organization_id,
    coalesce(
      customer.organization_id,
      conversation.organization_id,
      booking.organization_id,
      'b1addf00-0000-4000-8000-000000000001'::uuid
    ) AS projected_organization_id
  FROM public.communication_consent consent
  LEFT JOIN public.customers customer ON customer.id = consent.customer_id
  LEFT JOIN public.chat_conversations conversation
    ON conversation.id = consent.conversation_id
  LEFT JOIN public.bookings booking ON booking.id = consent.booking_id
),
consent_state AS (
  SELECT
    count(*) AS consent_count,
    count(*) FILTER (
      WHERE customer_organization_id IS NOT NULL
         OR conversation_organization_id IS NOT NULL
         OR booking_organization_id IS NOT NULL
    ) AS parented_consent_count,
    count(*) FILTER (
      WHERE customer_organization_id IS NULL
        AND conversation_organization_id IS NULL
        AND booking_organization_id IS NULL
    ) AS unparented_consent_count,
    count(*) FILTER (
      WHERE (customer_organization_id IS NOT NULL
              AND conversation_organization_id IS NOT NULL
              AND customer_organization_id <> conversation_organization_id)
         OR (customer_organization_id IS NOT NULL
              AND booking_organization_id IS NOT NULL
              AND customer_organization_id <> booking_organization_id)
         OR (conversation_organization_id IS NOT NULL
              AND booking_organization_id IS NOT NULL
              AND conversation_organization_id <> booking_organization_id)
    ) AS parent_conflict_count,
    count(*) FILTER (
      WHERE (customer_id IS NOT NULL AND joined_customer_id IS NULL)
         OR (conversation_id IS NOT NULL AND joined_conversation_id IS NULL)
         OR (booking_id IS NOT NULL AND joined_booking_id IS NULL)
    ) AS orphan_parent_count,
    count(*) FILTER (
      WHERE coalesce(
        customer_organization_id,
        conversation_organization_id,
        booking_organization_id
      ) IS NOT NULL
        AND coalesce(
          customer_organization_id,
          conversation_organization_id,
          booking_organization_id
        ) <> 'b1addf00-0000-4000-8000-000000000001'::uuid
    ) AS non_dfw_parent_count
  FROM consent_lineage
),
projected_collisions AS (
  SELECT count(*) AS projected_identity_collision_count
  FROM (
    SELECT
      projected_organization_id,
      channel,
      consent_type,
      CASE
        WHEN channel = 'sms' THEN normalized_phone
        ELSE normalized_email
      END AS normalized_identity
    FROM consent_lineage
    WHERE CASE
      WHEN channel = 'sms' THEN normalized_phone
      ELSE normalized_email
    END IS NOT NULL
    GROUP BY
      projected_organization_id,
      channel,
      consent_type,
      CASE
        WHEN channel = 'sms' THEN normalized_phone
        ELSE normalized_email
      END
    HAVING count(*) > 1
  ) collisions
),
event_state AS (
  SELECT
    count(*) AS consent_event_count,
    count(*) FILTER (WHERE consent.id IS NULL) AS orphan_consent_event_count
  FROM public.communication_consent_events event
  LEFT JOIN public.communication_consent consent
    ON consent.id = event.consent_id
),
klamath_state AS (
  SELECT
    (SELECT count(*) FROM public.customers
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_customer_count,
    (SELECT count(*) FROM public.chat_conversations
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_conversation_count,
    (SELECT count(*) FROM public.bookings
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS klamath_booking_count,
    (SELECT count(*) FROM consent_lineage
      WHERE projected_organization_id =
        'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS projected_klamath_consent_count
),
security_state AS (
  SELECT
    count(*) FILTER (
      WHERE tablename = 'communication_consent'
    ) AS consent_policy_count,
    count(*) FILTER (
      WHERE tablename = 'communication_consent_events'
    ) AS consent_event_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
),
rls_state AS (
  SELECT
    count(*) FILTER (
      WHERE relname = 'communication_consent' AND relrowsecurity
    ) AS consent_rls_enabled_count,
    count(*) FILTER (
      WHERE relname = 'communication_consent_events' AND relrowsecurity
    ) AS consent_event_rls_enabled_count
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND relname IN (
      'communication_consent',
      'communication_consent_events'
    )
)
SELECT jsonb_build_object(
  'prerequisite_table_count', prerequisites.prerequisite_table_count,
  'consent_organization_column_count',
    target_state.consent_organization_column_count,
  'event_organization_column_count',
    target_state.event_organization_column_count,
  'organization_record_function_count',
    function_state.organization_record_function_count,
  'organization_allows_function_count',
    function_state.organization_allows_function_count,
  'legacy_record_function_count', function_state.legacy_record_function_count,
  'legacy_allows_function_count', function_state.legacy_allows_function_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'consent_count', consent_state.consent_count,
  'parented_consent_count', consent_state.parented_consent_count,
  'unparented_consent_count', consent_state.unparented_consent_count,
  'parent_conflict_count', consent_state.parent_conflict_count,
  'orphan_parent_count', consent_state.orphan_parent_count,
  'non_dfw_parent_count', consent_state.non_dfw_parent_count,
  'projected_identity_collision_count',
    projected_collisions.projected_identity_collision_count,
  'consent_event_count', event_state.consent_event_count,
  'orphan_consent_event_count', event_state.orphan_consent_event_count,
  'klamath_customer_count', klamath_state.klamath_customer_count,
  'klamath_conversation_count', klamath_state.klamath_conversation_count,
  'klamath_booking_count', klamath_state.klamath_booking_count,
  'projected_klamath_consent_count',
    klamath_state.projected_klamath_consent_count,
  'consent_policy_count', security_state.consent_policy_count,
  'consent_event_policy_count', security_state.consent_event_policy_count,
  'consent_rls_enabled_count', rls_state.consent_rls_enabled_count,
  'consent_event_rls_enabled_count', rls_state.consent_event_rls_enabled_count
) AS phase_1h_preflight
FROM prerequisites, target_state, function_state, organization_state,
  consent_state, projected_collisions, event_state, klamath_state,
  security_state, rls_state;

ROLLBACK;
