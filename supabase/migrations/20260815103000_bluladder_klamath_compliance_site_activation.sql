-- BluLadder Klamath compliance-only public-site lifecycle switch.
-- Repository preparation only. Applying this migration remains a separately
-- authorized production action after every public-surface gate passes.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

LOCK TABLE public.organizations, public.organization_customer_sites
  IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE
  public.organization_settings,
  public.organization_resolution_keys,
  public.organization_public_contacts,
  public.organization_memberships,
  public.organization_contacts,
  public.organization_territories,
  public.organization_services,
  public.organization_pricing_profiles,
  public.organization_crm_connectors,
  public.organization_messaging_connectors
  IN SHARE MODE;

DO $klamath_compliance_site_preflight$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
BEGIN
  IF (SELECT count(*) FROM public.organizations
      WHERE id = 'b1addf00-0000-4000-8000-000000000001'::uuid
        AND slug = 'bluladder-dfw'
        AND status = 'active'
        AND is_legacy_default = true) <> 1
    OR (SELECT count(*) FROM public.organizations
      WHERE is_legacy_default = true
        AND id <> 'b1addf00-0000-4000-8000-000000000001'::uuid) <> 0
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires the exact DFW default';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id
        AND slug = 'bluladder-klamath'
        AND display_name = 'BluLadder Klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id OR slug = 'bluladder-klamath') <> 1
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires one provisioning organization';
  END IF;

  IF (SELECT count(*) FROM public.organization_settings
      WHERE organization_id = klamath_id
        AND public_name = 'BluLadder Klamath'
        AND branding ->> 'tagline' = 'Next Level Clean') <> 1
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires exact public settings';
  END IF;

  IF (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'provisioning'
        AND runtime_routing_enabled = false
        AND site_published = false
        AND customer_traffic_allowed = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        OR tenant_key = 'bluladder-klamath'
        OR canonical_hostname = 'klamath.bluladder.com') <> 1
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires one inactive customer site';
  END IF;

  IF (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND key_type = 'hostname'
        AND status = 'disabled') <> 1
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires one disabled hostname key';
  END IF;

  IF (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id AND status = 'published') <> 2
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'published' AND channel = 'phone') <> 1
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'published' AND channel = 'sms') <> 1
    OR (SELECT count(DISTINCT destination)
      FROM public.organization_public_contacts
      WHERE organization_id = klamath_id AND status = 'published') <> 2
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'published'
        AND owner_approved_at IS NOT NULL
        AND owner_approval_reference_hash ~ '^[0-9a-f]{64}$'
        AND verified_at IS NOT NULL
        AND published_at IS NOT NULL
        AND published_at >= owner_approved_at
        AND published_at >= verified_at) <> 2
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires two complete public contacts';
  END IF;

  IF (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.organization_contacts
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id
        AND status = 'inactive'
        AND effect = 'include'
        AND state_code = 'OR'
        AND county_name IN ('Klamath', 'Lake')) <> 2
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id AND status = 'active') <> 0
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id) <> 6
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'inactive' AND availability = 'manual_review') <> 6
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND (status = 'active' OR availability = 'available')) <> 0
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires inactive territory and service state';
  END IF;

  IF (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id
        AND status = 'draft' AND runtime_enabled = false) <> 1
    OR (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false) <> 1
    OR (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id) <> 0
  THEN
    RAISE EXCEPTION 'Klamath compliance activation requires inactive provider and pricing state';
  END IF;
END
$klamath_compliance_site_preflight$;

UPDATE public.organizations
SET status = 'active', updated_at = now()
WHERE id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'provisioning'
  AND is_legacy_default = false;

UPDATE public.organization_customer_sites
SET
  mapping_status = 'active',
  runtime_routing_enabled = true,
  site_published = true,
  customer_traffic_allowed = false,
  updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND tenant_key = 'bluladder-klamath'
  AND canonical_hostname = 'klamath.bluladder.com'
  AND mapping_status = 'provisioning'
  AND runtime_routing_enabled = false
  AND site_published = false
  AND customer_traffic_allowed = false;

DO $klamath_compliance_site_postflight$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
BEGIN
  IF (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id
        AND slug = 'bluladder-klamath'
        AND status = 'active'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath compliance activation lifecycle update did not complete';
  END IF;

  IF (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND key_type = 'hostname' AND status = 'disabled') <> 1
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id AND status = 'published') <> 2
    OR (SELECT count(DISTINCT destination)
      FROM public.organization_public_contacts
      WHERE organization_id = klamath_id AND status = 'published') <> 2
  THEN
    RAISE EXCEPTION 'Klamath compliance activation authority state drifted';
  END IF;

  IF (SELECT count(*) FROM public.organization_memberships
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.organization_contacts
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id AND status = 'active') <> 0
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND (status = 'active' OR availability = 'available')) <> 0
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id AND runtime_enabled) <> 0
    OR (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id
        AND (status = 'active' OR runtime_enabled OR webhook_enabled)) <> 0
    OR (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id) <> 0
  THEN
    RAISE EXCEPTION 'Klamath compliance activation enabled a forbidden runtime';
  END IF;
END
$klamath_compliance_site_postflight$;

COMMIT;
