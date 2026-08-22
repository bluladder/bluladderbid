-- Read-only preflight for the Klamath activation supersession.
-- Protected destinations are represented only by non-reversible fingerprints.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH k AS (
  SELECT 'b1addf00-0000-4000-8000-000000000003'::uuid AS id
), organization_state AS (
  SELECT
    count(*) FILTER (
      WHERE id = (SELECT id FROM k)
        AND slug = 'bluladder-klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false
    ) AS exact_klamath_provisioning_count,
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
  SELECT count(*) AS exact_inactive_site_count
  FROM public.organization_customer_sites
  WHERE organization_id = (SELECT id FROM k)
    AND tenant_key = 'bluladder-klamath'
    AND canonical_hostname = 'klamath.bluladder.com'
    AND mapping_status = 'provisioning'
    AND runtime_routing_enabled = false
    AND site_published = false
    AND customer_traffic_allowed = false
), contact_state AS (
  SELECT
    count(*) AS public_contact_count,
    count(*) FILTER (WHERE status = 'draft' AND channel = 'phone')
      AS draft_phone_count,
    count(*) FILTER (WHERE status = 'draft' AND channel = 'sms')
      AS draft_sms_count,
    count(*) FILTER (WHERE status = 'published') AS published_contact_count
  FROM public.organization_public_contacts
  WHERE organization_id = (SELECT id FROM k)
), resolution_state AS (
  SELECT
    count(*) FILTER (
      WHERE key_type = 'hostname' AND status = 'disabled'
    ) AS disabled_hostname_count,
    count(*) FILTER (
      WHERE key_type IN ('vapi_assistant', 'vapi_phone_number')
    ) AS provider_mapping_count
  FROM public.organization_resolution_keys
  WHERE organization_id = (SELECT id FROM k)
), provider_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = (SELECT id FROM k)
        AND id = 'b1addf00-0000-4000-8000-000000007001'::uuid
        AND channel = 'sms'
        AND provider = 'twilio'
        AND status = 'inactive'
        AND credential_reference =
          'bluladder-klamath-twilio-production-v1'
        AND sender_identity_reference ~ '^MG[0-9a-f]{32}$')
      AS exact_inactive_sms_connector_count,
    (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = (SELECT id FROM k)
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false)
      AS exact_inactive_jobtread_count
), authority_state AS (
  SELECT
    count(*) AS protected_recipient_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000006001'::uuid
        AND role = 'primary'
        AND categories = '["transfer_destination"]'::jsonb
        AND is_enabled = false
        AND verified_at IS NOT NULL
    ) AS exact_transfer_destination_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000006002'::uuid
        AND role = 'backup'
        AND categories = '["operational_alert_recipient"]'::jsonb
        AND is_enabled = false
        AND verified_at IS NOT NULL
        AND email IS NOT NULL
    ) AS exact_operational_alert_count,
    encode(
      digest(
        coalesce(string_agg(
          jsonb_build_object(
            'id', id,
            'role', role,
            'categories', categories,
            'enabled', is_enabled,
            'verified', verified_at IS NOT NULL,
            'phone_sha256', encode(digest(phone, 'sha256'), 'hex'),
            'email_sha256', CASE WHEN email IS NULL THEN NULL
              ELSE encode(digest(lower(email), 'sha256'), 'hex') END
          )::text,
          '|' ORDER BY id
        ), ''),
        'sha256'
      ),
      'hex'
    ) AS protected_authority_fingerprint
  FROM public.escalation_recipients
  WHERE organization_id = (SELECT id FROM k)
), runtime_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'inactive') AS inactive_territory_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'inactive'
        AND availability = 'manual_review') AS inactive_service_count,
    (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = (SELECT id FROM k)
        AND status = 'draft'
        AND runtime_enabled = false) AS draft_pricing_count
), ledger_state AS (
  SELECT
    count(*) FILTER (WHERE version = '20260815103000')
      AS superseded_version_count,
    count(*) FILTER (WHERE version = '20260822170000')
      AS replacement_version_count
  FROM supabase_migrations.schema_migrations
)
SELECT jsonb_build_object(
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_inactive_site_count', site_state.exact_inactive_site_count,
  'public_contact_count', contact_state.public_contact_count,
  'draft_phone_count', contact_state.draft_phone_count,
  'draft_sms_count', contact_state.draft_sms_count,
  'published_contact_count', contact_state.published_contact_count,
  'disabled_hostname_count', resolution_state.disabled_hostname_count,
  'provider_mapping_count', resolution_state.provider_mapping_count,
  'exact_inactive_sms_connector_count',
    provider_state.exact_inactive_sms_connector_count,
  'exact_inactive_jobtread_count', provider_state.exact_inactive_jobtread_count,
  'protected_recipient_count', authority_state.protected_recipient_count,
  'exact_transfer_destination_count',
    authority_state.exact_transfer_destination_count,
  'exact_operational_alert_count',
    authority_state.exact_operational_alert_count,
  'protected_authority_fingerprint',
    authority_state.protected_authority_fingerprint,
  'inactive_territory_count', runtime_state.inactive_territory_count,
  'inactive_service_count', runtime_state.inactive_service_count,
  'draft_pricing_count', runtime_state.draft_pricing_count,
  'superseded_version_count', ledger_state.superseded_version_count,
  'replacement_version_count', ledger_state.replacement_version_count
) AS bluladder_klamath_activation_supersession_preflight
FROM organization_state, site_state, contact_state, resolution_state,
  provider_state, authority_state, runtime_state, ledger_state;

ROLLBACK;
