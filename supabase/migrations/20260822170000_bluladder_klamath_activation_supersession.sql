-- BluLadder Klamath forward-only activation supersession.
--
-- This migration intentionally supersedes, but does not edit or replay,
-- 20260815103000_bluladder_klamath_compliance_site_activation.sql. Protected
-- provider and operator bindings must already exist in the exact inactive
-- state asserted below. The migration stages a fully configured tenant while
-- keeping customer traffic false until the reviewed post-deploy cutover.

BEGIN;

SET LOCAL statement_timeout = '20s';
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
  public.escalation_recipients
IN SHARE ROW EXCLUSIVE MODE;

DO $klamath_activation_preflight$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
  transfer_id constant uuid :=
    'b1addf00-0000-4000-8000-000000006001'::uuid;
  alert_id constant uuid :=
    'b1addf00-0000-4000-8000-000000006002'::uuid;
  messaging_id constant uuid :=
    'b1addf00-0000-4000-8000-000000007001'::uuid;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260815103000'
  ) THEN
    RAISE EXCEPTION 'Superseded Klamath compliance migration was applied';
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
    RAISE EXCEPTION 'Klamath activation requires the exact DFW default';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id
        AND slug = 'bluladder-klamath'
        AND display_name = 'BluLadder Klamath'
        AND status = 'provisioning'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'provisioning'
        AND runtime_routing_enabled = false
        AND site_published = false
        AND customer_traffic_allowed = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath activation requires the exact inactive tenant';
  END IF;

  IF (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'draft'
        AND channel = 'phone') <> 1
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'draft'
        AND channel = 'sms') <> 1
  THEN
    RAISE EXCEPTION 'Klamath activation requires the two reviewed draft contacts';
  END IF;

  IF (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND key_type = 'hostname'
        AND key_hash =
          '0ef6fcf28e127279570a272e667e488bbda76191b99d204e78f4d936343a4c77'
        AND status = 'disabled') <> 1
    OR EXISTS (
      SELECT 1
      FROM public.organization_resolution_keys
      WHERE key_type = 'vapi_assistant'
        AND key_hash =
          '2948eb8faaf4e73a74a9351b20c2fecc8b216f5903c94f11068cd8e98af6a456'
    )
    OR EXISTS (
      SELECT 1
      FROM public.organization_resolution_keys
      WHERE key_type = 'vapi_phone_number'
        AND key_hash =
          '03c86d5e45e407bcaa08a8df827000c9f337640d939bb3b265fbcec874893a5b'
    )
  THEN
    RAISE EXCEPTION 'Klamath provider-resolution preflight failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id
        AND status = 'inactive'
        AND effect = 'include'
        AND state_code = 'OR'
        AND county_name IN ('Klamath', 'Lake')) <> 2
    OR (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'inactive'
        AND availability = 'manual_review') <> 6
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id) <> 6
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id
        AND id = 'b1addf00-0000-4000-8000-000000002003'::uuid
        AND profile_key = 'bluladder-klamath-pricing-draft'
        AND version = 1
        AND status = 'draft'
        AND runtime_enabled = false
        AND currency_code = 'USD'
        AND tax_policy = 'oregon_no_general_sales_tax'
        AND encode(digest(config_snapshot::text, 'sha256'), 'hex') =
          'cc56912810e31f3cb508e3062bf16526cb9767629347fe4d75142a37d0ecccd2') <> 1
  THEN
    RAISE EXCEPTION 'Klamath territory, service, or pricing preflight failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath JobTread connector must remain inactive';
  END IF;

  IF (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id) <> 1
    OR (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE id = messaging_id
        AND organization_id = klamath_id
        AND channel = 'sms'
        AND provider = 'twilio'
        AND status = 'inactive'
        AND priority = 100
        AND credential_reference =
          'bluladder-klamath-twilio-production-v1'
        AND sender_identity_reference ~ '^MG[0-9a-f]{32}$') <> 1
  THEN
    RAISE EXCEPTION 'Klamath protected SMS connector is not exact';
  END IF;

  IF (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id) <> 2
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE id = transfer_id
        AND organization_id = klamath_id
        AND role = 'primary'
        AND categories = '["transfer_destination"]'::jsonb
        AND is_enabled = false
        AND verified_at IS NOT NULL
        AND phone ~ '^\+[1-9][0-9]{7,14}$') <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE id = alert_id
        AND organization_id = klamath_id
        AND role = 'backup'
        AND categories = '["operational_alert_recipient"]'::jsonb
        AND is_enabled = false
        AND verified_at IS NOT NULL
        AND phone ~ '^\+[1-9][0-9]{7,14}$'
        AND email = lower(email)
        AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') <> 1
    OR EXISTS (
      SELECT 1
      FROM public.escalation_recipients transfer
      JOIN public.escalation_recipients alert
        ON transfer.organization_id = alert.organization_id
      WHERE transfer.id = transfer_id
        AND alert.id = alert_id
        AND (
          transfer.phone = alert.phone
          OR transfer.phone = '+15418718617'
          OR alert.phone = '+15418718617'
          OR alert.email = 'klamath@bluladder.com'
          OR transfer.phone IN (
            SELECT destination
            FROM public.organization_public_contacts
            WHERE organization_id = klamath_id
              AND status = 'published'
          )
          OR alert.phone IN (
            SELECT destination
            FROM public.organization_public_contacts
            WHERE organization_id = klamath_id
              AND status = 'published'
          )
          OR alert.email IN (
            SELECT destination
            FROM public.organization_public_contacts
            WHERE organization_id = klamath_id
              AND status = 'published'
          )
        )
    )
  THEN
    RAISE EXCEPTION 'Klamath protected voice authorities are not exact and private';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_memberships
      WHERE organization_id = klamath_id)
    OR EXISTS (SELECT 1 FROM public.organization_contacts
      WHERE organization_id = klamath_id)
  THEN
    RAISE EXCEPTION 'Klamath activation found unexpected memberships or contacts';
  END IF;
END
$klamath_activation_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS
  escalation_recipients_one_active_transfer_destination_idx
ON public.escalation_recipients (organization_id)
WHERE is_enabled = true
  AND categories @> '["transfer_destination"]'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS
  escalation_recipients_one_active_operational_alert_idx
ON public.escalation_recipients (organization_id)
WHERE is_enabled = true
  AND categories @> '["operational_alert_recipient"]'::jsonb;

UPDATE public.organization_public_contacts
SET
  channel = CASE WHEN channel = 'sms' THEN 'email' ELSE channel END,
  label = CASE
    WHEN channel = 'phone' THEN 'Call BluLadder Klamath'
    ELSE 'Email BluLadder Klamath'
  END,
  destination = CASE
    WHEN channel = 'phone' THEN '+15418718617'
    ELSE 'klamath@bluladder.com'
  END,
  status = 'published',
  owner_approved_at = now(),
  owner_approval_reference_hash =
    'dd1a077baf0e03619515cda1dfd4dd6126e7d7859140fb2b232dc3d8b831aab1',
  verified_at = CASE
    WHEN channel = 'phone'
      THEN '2026-08-22T15:18:43.854Z'::timestamptz
    ELSE '2026-08-22T17:09:28Z'::timestamptz
  END,
  published_at = now(),
  configuration_version = 2,
  updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'draft'
  AND channel IN ('phone', 'sms');

INSERT INTO public.organization_resolution_keys (
  id, organization_id, key_type, key_hash, status
) VALUES
  (
    'b1addf00-0000-4000-8000-000000005002',
    'b1addf00-0000-4000-8000-000000000003',
    'vapi_assistant',
    '2948eb8faaf4e73a74a9351b20c2fecc8b216f5903c94f11068cd8e98af6a456',
    'active'
  ),
  (
    'b1addf00-0000-4000-8000-000000005003',
    'b1addf00-0000-4000-8000-000000000003',
    'vapi_phone_number',
    '03c86d5e45e407bcaa08a8df827000c9f337640d939bb3b265fbcec874893a5b',
    'active'
  );

UPDATE public.organization_resolution_keys
SET status = 'active', updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND key_type = 'hostname'
  AND status = 'disabled';

UPDATE public.organization_territories
SET status = 'active', updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'inactive';

UPDATE public.organization_services
SET
  status = 'active',
  availability = CASE
    WHEN service_key IN (
      'window_cleaning',
      'gutter_cleaning',
      'house_wash',
      'pressure_washing'
    ) THEN 'available'
    ELSE 'manual_review'
  END,
  reason = CASE
    WHEN service_key IN (
      'window_cleaning',
      'gutter_cleaning',
      'house_wash',
      'pressure_washing'
    ) THEN NULL
    ELSE reason
  END,
  updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'inactive';

UPDATE public.organization_pricing_profiles
SET status = 'approved', runtime_enabled = true, updated_at = now()
WHERE id = 'b1addf00-0000-4000-8000-000000002003'::uuid
  AND organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'draft'
  AND runtime_enabled = false;

UPDATE public.organization_messaging_connectors
SET status = 'active', updated_at = now()
WHERE id = 'b1addf00-0000-4000-8000-000000007001'::uuid
  AND organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND status = 'inactive';

UPDATE public.escalation_recipients
SET is_enabled = true, updated_at = now()
WHERE organization_id = 'b1addf00-0000-4000-8000-000000000003'::uuid
  AND id IN (
    'b1addf00-0000-4000-8000-000000006001'::uuid,
    'b1addf00-0000-4000-8000-000000006002'::uuid
  )
  AND is_enabled = false;

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
  AND mapping_status = 'provisioning'
  AND runtime_routing_enabled = false
  AND site_published = false
  AND customer_traffic_allowed = false;

DO $klamath_activation_postflight$
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
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = false) <> 1
    OR (SELECT count(*) FROM public.organization_public_contacts
      WHERE organization_id = klamath_id
        AND status = 'published'
        AND channel IN ('phone', 'email')
        AND owner_approved_at IS NOT NULL
        AND verified_at IS NOT NULL
        AND published_at IS NOT NULL) <> 2
    OR (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = klamath_id
        AND status = 'active'
        AND key_type IN ('hostname', 'vapi_assistant', 'vapi_phone_number')) <> 3
  THEN
    RAISE EXCEPTION 'Klamath tenant, public contact, or mapping activation failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_territories
      WHERE organization_id = klamath_id AND status = 'active') <> 2
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'active' AND availability = 'available') <> 4
    OR (SELECT count(*) FROM public.organization_services
      WHERE organization_id = klamath_id
        AND status = 'active' AND availability = 'manual_review') <> 2
    OR (SELECT count(*) FROM public.organization_pricing_profiles
      WHERE organization_id = klamath_id
        AND status = 'approved' AND runtime_enabled = true) <> 1
    OR (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id
        AND channel = 'sms' AND provider = 'twilio'
        AND status = 'active') <> 1
  THEN
    RAISE EXCEPTION 'Klamath service, pricing, or messaging activation failed';
  END IF;

  IF (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND is_enabled = true
        AND verified_at IS NOT NULL
        AND categories = '["transfer_destination"]'::jsonb) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND is_enabled = true
        AND verified_at IS NOT NULL
        AND categories = '["operational_alert_recipient"]'::jsonb) <> 1
    OR (SELECT count(*) FROM public.organization_crm_connectors
      WHERE organization_id = klamath_id
        AND provider = 'jobtread'
        AND status = 'inactive'
        AND runtime_enabled = false
        AND webhook_enabled = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath protected authority or CRM isolation failed';
  END IF;

  IF EXISTS (SELECT 1 FROM public.organization_memberships
      WHERE organization_id = klamath_id)
    OR EXISTS (SELECT 1 FROM public.organization_contacts
      WHERE organization_id = klamath_id)
  THEN
    RAISE EXCEPTION 'Klamath activation created forbidden customer data';
  END IF;
END
$klamath_activation_postflight$;

COMMIT;
