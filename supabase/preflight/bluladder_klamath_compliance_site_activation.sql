-- Read-only preflight for the BluLadder Klamath compliance-only site switch.
-- This probe must pass before a separately reviewed lifecycle mutation exists.
-- It deliberately requires customer traffic and every provider runtime to stay off.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH organization_state AS (
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
), site_state AS (
  SELECT count(*) AS exact_inactive_site_count
  FROM public.organization_customer_sites
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
    AND tenant_key = 'bluladder-klamath'
    AND canonical_hostname = 'klamath.bluladder.com'
    AND mapping_status = 'provisioning'
    AND runtime_routing_enabled = false
    AND site_published = false
    AND customer_traffic_allowed = false
), resolution_state AS (
  SELECT
    count(*) FILTER (
      WHERE key_type = 'hostname' AND status = 'disabled'
    ) AS exact_disabled_hostname_count,
    count(*) FILTER (
      WHERE key_type <> 'hostname' OR status <> 'disabled'
    ) AS unexpected_resolution_key_count
  FROM public.organization_resolution_keys
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
), contact_state AS (
  SELECT
    count(*) AS public_contact_count,
    count(*) FILTER (WHERE status = 'published')
      AS published_public_contact_count,
    count(*) FILTER (WHERE status = 'published' AND channel = 'phone')
      AS published_phone_contact_count,
    count(*) FILTER (WHERE status = 'published' AND channel = 'sms')
      AS published_sms_contact_count,
    count(DISTINCT destination) FILTER (WHERE status = 'published')
      AS distinct_public_destination_count,
    count(*) FILTER (
      WHERE status = 'published'
        AND owner_approved_at IS NOT NULL
        AND owner_approval_reference_hash ~ '^[0-9a-f]{64}$'
        AND verified_at IS NOT NULL
        AND published_at IS NOT NULL
        AND published_at >= owner_approved_at
        AND published_at >= verified_at
    ) AS complete_public_contact_evidence_count
  FROM public.organization_public_contacts
  WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
), inactive_state AS (
  SELECT
    (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS membership_count,
    (SELECT count(*) FROM public.organization_contacts
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS internal_contact_count,
    (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND status = 'inactive'
        AND effect = 'include'
        AND state_code = 'OR'
        AND county_name IN ('Klamath', 'Lake')) AS inactive_territory_count,
    (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS territory_count,
    (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND status = 'active') AS active_territory_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND status = 'inactive'
        AND availability = 'manual_review') AS inactive_manual_service_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS service_count,
    (SELECT count(*) FROM public.organization_services
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND (status = 'active' OR availability = 'available'))
      AS active_service_count,
    (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND status = 'draft'
        AND runtime_enabled = false) AS draft_disabled_pricing_count,
    (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS pricing_profile_count,
    (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND runtime_enabled) AS runtime_pricing_count,
    (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false) AS inactive_jobtread_connector_count,
    (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS crm_connector_count,
    (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND (status = 'active' OR runtime_enabled OR webhook_enabled))
      AS active_crm_connector_count,
    (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
        AND status = 'active') AS active_messaging_connector_count,
    (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid)
      AS messaging_connector_count
)
SELECT jsonb_build_object(
  'exact_dfw_default_count', organization_state.exact_dfw_default_count,
  'unexpected_legacy_default_count',
    organization_state.unexpected_legacy_default_count,
  'exact_klamath_provisioning_count',
    organization_state.exact_klamath_provisioning_count,
  'exact_inactive_site_count', site_state.exact_inactive_site_count,
  'exact_disabled_hostname_count',
    resolution_state.exact_disabled_hostname_count,
  'unexpected_resolution_key_count',
    resolution_state.unexpected_resolution_key_count,
  'public_contact_count', contact_state.public_contact_count,
  'published_public_contact_count',
    contact_state.published_public_contact_count,
  'published_phone_contact_count', contact_state.published_phone_contact_count,
  'published_sms_contact_count', contact_state.published_sms_contact_count,
  'distinct_public_destination_count',
    contact_state.distinct_public_destination_count,
  'complete_public_contact_evidence_count',
    contact_state.complete_public_contact_evidence_count,
  'membership_count', inactive_state.membership_count,
  'internal_contact_count', inactive_state.internal_contact_count,
  'inactive_territory_count', inactive_state.inactive_territory_count,
  'territory_count', inactive_state.territory_count,
  'active_territory_count', inactive_state.active_territory_count,
  'inactive_manual_service_count', inactive_state.inactive_manual_service_count,
  'service_count', inactive_state.service_count,
  'active_service_count', inactive_state.active_service_count,
  'draft_disabled_pricing_count', inactive_state.draft_disabled_pricing_count,
  'pricing_profile_count', inactive_state.pricing_profile_count,
  'runtime_pricing_count', inactive_state.runtime_pricing_count,
  'inactive_jobtread_connector_count',
    inactive_state.inactive_jobtread_connector_count,
  'crm_connector_count', inactive_state.crm_connector_count,
  'active_crm_connector_count', inactive_state.active_crm_connector_count,
  'active_messaging_connector_count',
    inactive_state.active_messaging_connector_count,
  'messaging_connector_count', inactive_state.messaging_connector_count
) AS klamath_compliance_site_activation_preflight
FROM organization_state, site_state, resolution_state, contact_state,
  inactive_state;

ROLLBACK;
