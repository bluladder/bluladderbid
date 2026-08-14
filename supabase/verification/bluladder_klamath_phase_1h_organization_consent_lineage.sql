BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

SELECT
  count(*) FILTER (
    WHERE table_name = 'communication_consent'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) AS consent_required_organization_column_count,
  count(*) FILTER (
    WHERE table_name = 'communication_consent_events'
      AND column_name = 'organization_id'
      AND is_nullable = 'NO'
  ) AS event_required_organization_column_count,
  count(*) FILTER (
    WHERE table_name = 'communication_consent_events'
      AND column_name = 'consent_id'
      AND is_nullable = 'NO'
  ) AS event_required_consent_column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'communication_consent', 'communication_consent_events'
  );

SELECT
  count(*) AS consent_count,
  count(*) FILTER (WHERE organization_id IS NULL)
    AS consent_missing_organization_count,
  count(*) FILTER (
    WHERE organization_id <> 'b1addf00-0000-4000-8000-000000000001'
  ) AS historical_non_dfw_consent_count
FROM public.communication_consent;

SELECT
  count(*) AS consent_event_count,
  count(*) FILTER (WHERE event.organization_id IS NULL)
    AS event_missing_organization_count,
  count(*) FILTER (
    WHERE event.organization_id <> consent.organization_id
  ) AS event_parent_mismatch_count
FROM public.communication_consent_events event
JOIN public.communication_consent consent ON consent.id = event.consent_id;

SELECT
  count(*) FILTER (
    WHERE indexname = 'uq_consent_organization_sms'
  ) AS scoped_sms_unique_index_count,
  count(*) FILTER (
    WHERE indexname = 'uq_consent_organization_email'
  ) AS scoped_email_unique_index_count,
  count(*) FILTER (
    WHERE indexname IN ('uq_consent_sms', 'uq_consent_email')
  ) AS legacy_global_unique_index_count
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'communication_consent';

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
  ) IS NOT NULL)::int AS legacy_allows_function_count;

SELECT
  has_function_privilege(
    'anon',
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)',
    'EXECUTE'
  )::int AS anon_record_execute,
  has_function_privilege(
    'authenticated',
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)',
    'EXECUTE'
  )::int AS authenticated_record_execute,
  has_function_privilege(
    'service_role',
    'public.record_organization_consent(uuid,public.consent_channel,public.consent_type,public.consent_status,text,text,text,text,uuid,uuid,text,uuid,uuid,jsonb)',
    'EXECUTE'
  )::int AS service_role_record_execute,
  has_function_privilege(
    'authenticated',
    'public.consent_allows_for_organization(uuid,public.consent_channel,public.consent_type,text,text)',
    'EXECUTE'
  )::int AS authenticated_allows_execute,
  has_function_privilege(
    'service_role',
    'public.consent_allows_for_organization(uuid,public.consent_channel,public.consent_type,text,text)',
    'EXECUTE'
  )::int AS service_role_allows_execute;

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
    'communication_consent', 'communication_consent_events'
  );

SELECT tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'communication_consent', 'communication_consent_events'
  )
ORDER BY tablename, policyname;

SELECT
  count(*) FILTER (
    WHERE tgname = 'enforce_communication_consent_organization_lineage'
      AND tgrelid = 'public.communication_consent'::regclass
  ) AS consent_lineage_trigger_count,
  count(*) FILTER (
    WHERE tgname = 'enforce_communication_consent_event_organization_lineage'
      AND tgrelid = 'public.communication_consent_events'::regclass
  ) AS event_lineage_trigger_count
FROM pg_trigger
WHERE NOT tgisinternal;

SELECT
  count(*) FILTER (
    WHERE slug = 'bluladder-klamath' AND status = 'provisioning'
  ) AS klamath_provisioning_count,
  count(*) FILTER (
    WHERE slug = 'bluladder-klamath' AND status = 'active'
  ) AS klamath_active_count
FROM public.organizations;

SELECT
  (SELECT count(*) FROM public.customers
   WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS klamath_customer_count,
  (SELECT count(*) FROM public.chat_conversations
   WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS klamath_conversation_count,
  (SELECT count(*) FROM public.bookings
   WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS klamath_booking_count,
  (SELECT count(*) FROM public.communication_consent
   WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003')
    AS klamath_consent_count;

ROLLBACK;
