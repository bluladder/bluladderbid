-- One-row BluLadder Klamath customer-traffic cutover.
--
-- DO NOT EXECUTE until the reviewed replacement migration is recorded exactly
-- once, the staged postflight passes, voice-vapi-events is deployed from the
-- exact merged release with the required build marker, authentication and
-- health checks pass, protected provider state is reverified, and the complete
-- DFW before/after fingerprint set matches. This transaction changes only the
-- unique Klamath site's customer_traffic_allowed flag.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

LOCK TABLE
  public.organizations,
  public.organization_customer_sites,
  public.organization_public_contacts,
  public.organization_resolution_keys,
  public.organization_territories,
  public.organization_services,
  public.organization_pricing_profiles,
  public.organization_messaging_connectors,
  public.organization_crm_connectors,
  public.escalation_recipients,
  public.organization_memberships,
  public.organization_contacts
IN SHARE ROW EXCLUSIVE MODE;

DO $klamath_customer_traffic_cutover$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
  affected_rows integer;
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20260815103000') <> 0
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20260822170000') <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover migration gate failed';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid) <> 0
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover DFW invariant failed';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id
        AND slug = 'bluladder-klamath'
        AND display_name = 'BluLadder Klamath'
        AND status = 'active'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover site gate failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND channel = 'phone'
        AND destination = '+15418718617'
        AND status = 'published'
        AND owner_approved_at IS NOT NULL
        AND verified_at IS NOT NULL
        AND published_at IS NOT NULL) <> 1
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND channel = 'email'
        AND destination = 'klamath@bluladder.com'
        AND status = 'published'
        AND owner_approved_at IS NOT NULL
        AND verified_at IS NOT NULL
        AND published_at IS NOT NULL) <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover public-contact gate failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id) <> 3
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND key_type = 'hostname') <> 1
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND key_type = 'vapi_assistant') <> 1
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND key_type = 'vapi_phone_number') <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover provider-resolution gate failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND effect = 'include'
        AND state_code = 'OR'
        AND county_name IN ('Klamath', 'Lake')) <> 2
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id) <> 6
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND availability = 'available'
        AND service_key IN (
          'window_cleaning',
          'gutter_cleaning',
          'house_wash',
          'pressure_washing'
        )) <> 4
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND availability = 'manual_review'
        AND service_key IN (
          'commercial_exterior_cleaning',
          'storefront_window_cleaning'
        )) <> 2
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id
        AND id = 'b1addf00-0000-4000-8000-000000002003'::uuid
        AND profile_key = 'bluladder-klamath-pricing-draft'
        AND version = 1
        AND status = 'approved'
        AND runtime_enabled = true
        AND currency_code = 'USD'
        AND tax_policy = 'oregon_no_general_sales_tax'
        AND encode(digest(config_snapshot::text, 'sha256'), 'hex') =
          'cc56912810e31f3cb508e3062bf16526cb9767629347fe4d75142a37d0ecccd2') <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover territory, service, or pricing gate failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE id = 'b1addf00-0000-4000-8000-000000007001'::uuid
        AND organization_id = klamath_id
        AND channel = 'sms'
        AND provider = 'twilio'
        AND status = 'active'
        AND priority = 100
        AND credential_reference = 'bluladder-klamath-twilio-production-v1'
        AND sender_identity_reference ~ '^MG[0-9a-f]{32}$') <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND id = 'b1addf00-0000-4000-8000-000000006001'::uuid
        AND role = 'primary'
        AND categories = '["transfer_destination"]'::jsonb
        AND is_enabled = true
        AND verified_at IS NOT NULL) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND id = 'b1addf00-0000-4000-8000-000000006002'::uuid
        AND role = 'backup'
        AND categories = '["operational_alert_recipient"]'::jsonb
        AND is_enabled = true
        AND verified_at IS NOT NULL) <> 1
    OR (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false) <> 1
    OR EXISTS (SELECT 1 FROM public.organization_memberships
      WHERE organization_id = klamath_id)
    OR EXISTS (SELECT 1 FROM public.organization_contacts
      WHERE organization_id = klamath_id)
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover authority or isolation gate failed';
  END IF;

  UPDATE public.organization_customer_sites
  SET customer_traffic_allowed = true, updated_at = now()
  WHERE organization_id = klamath_id
    AND tenant_key = 'bluladder-klamath'
    AND canonical_hostname = 'klamath.bluladder.com'
    AND mapping_status = 'active'
    AND runtime_routing_enabled = true
    AND site_published = true
    AND customer_traffic_allowed = false;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Klamath traffic cutover affected % rows, expected 1',
      affected_rows;
  END IF;

  IF (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = true) <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic cutover postcondition failed';
  END IF;
END
$klamath_customer_traffic_cutover$;

COMMIT;
