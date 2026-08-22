-- Read-only staged postflight. Customer traffic must remain disabled until the
-- repaired current-main voice-vapi-events build is deployed and healthy.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH k AS (
  SELECT 'b1addf00-0000-4000-8000-000000000003'::uuid AS id
)
SELECT jsonb_build_object(
  'active_organization_count', (
    SELECT count(*) FROM public.organizations
    WHERE id = (SELECT id FROM k)
      AND slug = 'bluladder-klamath'
      AND status = 'active'
      AND is_legacy_default = false
  ),
  'staged_site_count', (
    SELECT count(*) FROM public.organization_customer_sites
    WHERE organization_id = (SELECT id FROM k)
      AND mapping_status = 'active'
      AND runtime_routing_enabled = true
      AND site_published = true
      AND customer_traffic_allowed = false
  ),
  'published_phone_count', (
    SELECT count(*) FROM public.organization_public_contacts
    WHERE organization_id = (SELECT id FROM k)
      AND channel = 'phone'
      AND destination = '+15418718617'
      AND status = 'published'
      AND owner_approved_at IS NOT NULL
      AND verified_at IS NOT NULL
      AND published_at IS NOT NULL
  ),
  'published_email_count', (
    SELECT count(*) FROM public.organization_public_contacts
    WHERE organization_id = (SELECT id FROM k)
      AND channel = 'email'
      AND destination = 'klamath@bluladder.com'
      AND status = 'published'
      AND owner_approved_at IS NOT NULL
      AND verified_at IS NOT NULL
      AND published_at IS NOT NULL
  ),
  'active_resolution_count', (
    SELECT count(*) FROM public.organization_resolution_keys
    WHERE organization_id = (SELECT id FROM k)
      AND status = 'active'
      AND key_type IN ('hostname', 'vapi_assistant', 'vapi_phone_number')
  ),
  'active_territory_count', (
    SELECT count(*) FROM public.organization_territories
    WHERE organization_id = (SELECT id FROM k) AND status = 'active'
  ),
  'available_service_count', (
    SELECT count(*) FROM public.organization_services
    WHERE organization_id = (SELECT id FROM k)
      AND status = 'active' AND availability = 'available'
  ),
  'manual_review_service_count', (
    SELECT count(*) FROM public.organization_services
    WHERE organization_id = (SELECT id FROM k)
      AND status = 'active' AND availability = 'manual_review'
  ),
  'runtime_pricing_count', (
    SELECT count(*) FROM public.organization_pricing_profiles
    WHERE organization_id = (SELECT id FROM k)
      AND status = 'approved' AND runtime_enabled = true
  ),
  'active_sms_connector_count', (
    SELECT count(*) FROM public.organization_messaging_connectors
    WHERE organization_id = (SELECT id FROM k)
      AND channel = 'sms' AND provider = 'twilio' AND status = 'active'
  ),
  'active_transfer_destination_count', (
    SELECT count(*) FROM public.escalation_recipients
    WHERE organization_id = (SELECT id FROM k)
      AND is_enabled = true AND verified_at IS NOT NULL
      AND categories = '["transfer_destination"]'::jsonb
  ),
  'active_operational_alert_count', (
    SELECT count(*) FROM public.escalation_recipients
    WHERE organization_id = (SELECT id FROM k)
      AND is_enabled = true AND verified_at IS NOT NULL
      AND categories = '["operational_alert_recipient"]'::jsonb
  ),
  'active_jobtread_count', (
    SELECT count(*) FROM public.organization_crm_connectors
    WHERE organization_id = (SELECT id FROM k)
      AND (status = 'active' OR runtime_enabled OR webhook_enabled)
  ),
  'membership_count', (
    SELECT count(*) FROM public.organization_memberships
    WHERE organization_id = (SELECT id FROM k)
  ),
  'internal_contact_count', (
    SELECT count(*) FROM public.organization_contacts
    WHERE organization_id = (SELECT id FROM k)
  )
) AS bluladder_klamath_activation_supersession_postflight;

ROLLBACK;
