-- Read-only verification for the one-row Klamath customer-traffic cutover.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH k AS (
  SELECT 'b1addf00-0000-4000-8000-000000000003'::uuid AS id
), ledger_state AS (
  SELECT
    count(*) FILTER (WHERE version = '20260815103000')
      AS superseded_version_count,
    count(*) FILTER (WHERE version = '20260822170000')
      AS replacement_version_count
  FROM supabase_migrations.schema_migrations
), organization_state AS (
  SELECT
    count(*) FILTER (
      WHERE id = (SELECT id FROM k)
        AND slug = 'bluladder-klamath'
        AND status = 'active'
        AND is_legacy_default = false
    ) AS active_klamath_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true
    ) AS exact_dfw_default_count,
    count(*) FILTER (
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid
    ) AS unexpected_legacy_default_count
  FROM public.organizations
), site_state AS (
  SELECT
    count(*) AS klamath_site_count,
    count(*) FILTER (
      WHERE tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = true
    ) AS live_site_count
  FROM public.organization_customer_sites
  WHERE organization_id = (SELECT id FROM k)
), contact_state AS (
  SELECT
    count(*) AS public_contact_count,
    count(*) FILTER (
      WHERE channel = 'phone' AND status = 'published'
        AND owner_approved_at IS NOT NULL
        AND verified_at IS NOT NULL AND published_at IS NOT NULL
    ) AS published_phone_count,
    count(*) FILTER (
      WHERE channel = 'email' AND status = 'published'
        AND owner_approved_at IS NOT NULL
        AND verified_at IS NOT NULL AND published_at IS NOT NULL
    ) AS published_email_count
  FROM public.organization_public_contacts
  WHERE organization_id = (SELECT id FROM k)
), resolution_state AS (
  SELECT
    count(*) AS resolution_count,
    count(*) FILTER (WHERE key_type = 'hostname' AND status = 'active')
      AS active_hostname_count,
    count(*) FILTER (WHERE key_type = 'vapi_assistant' AND status = 'active')
      AS active_assistant_count,
    count(*) FILTER (WHERE key_type = 'vapi_phone_number' AND status = 'active')
      AS active_phone_count
  FROM public.organization_resolution_keys
  WHERE organization_id = (SELECT id FROM k)
), runtime_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = (SELECT id FROM k) AND status = 'active')
      AS active_territory_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'active' AND availability = 'available')
      AS available_service_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'active' AND availability = 'manual_review')
      AS manual_review_service_count,
    (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'approved' AND runtime_enabled = true)
      AS runtime_pricing_count
), authority_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = (SELECT id FROM k)
        AND channel = 'sms' AND provider = 'twilio' AND status = 'active')
      AS active_sms_connector_count,
    (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = (SELECT id FROM k)
        AND is_enabled = true AND verified_at IS NOT NULL
        AND categories = '["transfer_destination"]'::jsonb)
      AS active_transfer_destination_count,
    (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = (SELECT id FROM k)
        AND is_enabled = true AND verified_at IS NOT NULL
        AND categories = '["operational_alert_recipient"]'::jsonb)
      AS active_operational_alert_count,
    (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = (SELECT id FROM k)
        AND provider = 'jobtread'
        AND (status = 'active' OR runtime_enabled OR webhook_enabled))
      AS active_jobtread_count,
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id = (SELECT id FROM k)) AS membership_count,
    (SELECT count(*) FROM public.organization_contacts
      WHERE organization_id = (SELECT id FROM k)) AS internal_contact_count
)
SELECT jsonb_build_object(
  'superseded_version_count', ledger_state.superseded_version_count,
  'replacement_version_count', ledger_state.replacement_version_count,
  'active_klamath_count', organization_state.active_klamath_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'klamath_site_count', site_state.klamath_site_count,
  'live_site_count', site_state.live_site_count,
  'public_contact_count', contact_state.public_contact_count,
  'published_phone_count', contact_state.published_phone_count,
  'published_email_count', contact_state.published_email_count,
  'resolution_count', resolution_state.resolution_count,
  'active_hostname_count', resolution_state.active_hostname_count,
  'active_assistant_count', resolution_state.active_assistant_count,
  'active_phone_count', resolution_state.active_phone_count,
  'active_territory_count', runtime_state.active_territory_count,
  'available_service_count', runtime_state.available_service_count,
  'manual_review_service_count', runtime_state.manual_review_service_count,
  'runtime_pricing_count', runtime_state.runtime_pricing_count,
  'active_sms_connector_count', authority_state.active_sms_connector_count,
  'active_transfer_destination_count',
    authority_state.active_transfer_destination_count,
  'active_operational_alert_count',
    authority_state.active_operational_alert_count,
  'active_jobtread_count', authority_state.active_jobtread_count,
  'membership_count', authority_state.membership_count,
  'internal_contact_count', authority_state.internal_contact_count
) AS bluladder_klamath_customer_traffic_cutover_postflight
FROM ledger_state, organization_state, site_state, contact_state,
  resolution_state, runtime_state, authority_state;

ROLLBACK;
