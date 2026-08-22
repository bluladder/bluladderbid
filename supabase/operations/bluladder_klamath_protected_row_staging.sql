-- One-transaction staging of the three private Klamath runtime authorities.
--
-- Private values are supplied only for the current database session through
-- these custom settings and must never be committed or logged:
--   bluladder.klamath_sms_sender_identity
--   bluladder.klamath_transfer_phone
--   bluladder.klamath_alert_phone
--   bluladder.klamath_alert_email
--
-- This operation deliberately does not write the migration ledger. It inserts
-- exactly three disabled/inactive rows required by the separately reviewed
-- activation migration. Any mismatch aborts the complete transaction.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

LOCK TABLE
  public.organizations,
  public.organization_customer_sites,
  public.organization_public_contacts,
  public.organization_messaging_connectors,
  public.escalation_recipients,
  supabase_migrations.schema_migrations
IN SHARE ROW EXCLUSIVE MODE;

DO $klamath_protected_row_staging$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
  messaging_id constant uuid :=
    'b1addf00-0000-4000-8000-000000007001'::uuid;
  transfer_id constant uuid :=
    'b1addf00-0000-4000-8000-000000006001'::uuid;
  alert_id constant uuid :=
    'b1addf00-0000-4000-8000-000000006002'::uuid;
  sms_sender text := nullif(btrim(current_setting(
    'bluladder.klamath_sms_sender_identity', true
  )), '');
  transfer_phone text := nullif(btrim(current_setting(
    'bluladder.klamath_transfer_phone', true
  )), '');
  alert_phone text := nullif(btrim(current_setting(
    'bluladder.klamath_alert_phone', true
  )), '');
  alert_email text := nullif(lower(btrim(current_setting(
    'bluladder.klamath_alert_email', true
  ))), '');
  connector_rows integer;
  recipient_rows integer;
BEGIN
  IF sms_sender IS NULL OR transfer_phone IS NULL
    OR alert_phone IS NULL OR alert_email IS NULL
  THEN
    RAISE EXCEPTION 'Klamath protected staging parameters are incomplete';
  END IF;

  IF sms_sender !~ '^MG[0-9a-f]{32}$'
    OR transfer_phone !~ '^\+[1-9][0-9]{7,14}$'
    OR alert_phone !~ '^\+[1-9][0-9]{7,14}$'
    OR alert_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  THEN
    RAISE EXCEPTION 'Klamath protected staging parameter format failed';
  END IF;

  IF encode(digest(transfer_phone, 'sha256'), 'hex') <>
      'f413a45efe96381f82754c03dc0005c41785393303bda45837e2cd458f111008'
    OR encode(digest(alert_phone, 'sha256'), 'hex') <>
      '5634195d7b461a4ef99799146b1146c7f85e042931ca87246cfb9beadc22af65'
    OR encode(digest(alert_email, 'sha256'), 'hex') <>
      '733e21f1aa22bbaeb3bbd52b5377e1f6ce0531e81262611c14991c84c44089d8'
  THEN
    RAISE EXCEPTION 'Klamath protected staging authority fingerprint failed';
  END IF;

  IF transfer_phone = alert_phone
    OR transfer_phone = '+15418718617'
    OR alert_phone = '+15418718617'
    OR alert_email = 'klamath@bluladder.com'
  THEN
    RAISE EXCEPTION 'Klamath protected staging authority separation failed';
  END IF;

  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 166
    OR (SELECT max(version) FROM supabase_migrations.schema_migrations) <>
      '20260815043425'
    OR EXISTS (
      SELECT 1 FROM supabase_migrations.schema_migrations
      WHERE version IN ('20260815103000', '20260822170000')
    )
  THEN
    RAISE EXCEPTION 'Klamath protected staging migration-ledger gate failed';
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
    RAISE EXCEPTION 'Klamath protected staging tenant/site gate failed';
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
    RAISE EXCEPTION 'Klamath protected staging DFW invariant failed';
  END IF;

  IF (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id) <> 0
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND categories = '["transfer_destination"]'::jsonb) <> 0
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = klamath_id
        AND categories = '["operational_alert_recipient"]'::jsonb) <> 0
    OR EXISTS (
      SELECT 1 FROM public.organization_messaging_connectors
      WHERE id = messaging_id OR sender_identity_reference = sms_sender
    )
    OR EXISTS (
      SELECT 1 FROM public.escalation_recipients
      WHERE id IN (transfer_id, alert_id)
        OR phone IN (transfer_phone, alert_phone)
        OR lower(email) = alert_email
    )
  THEN
    RAISE EXCEPTION 'Klamath protected staging collision gate failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_public_contacts
    WHERE organization_id = klamath_id
      AND lower(destination) IN (
        lower(transfer_phone), lower(alert_phone), alert_email
      )
  ) THEN
    RAISE EXCEPTION 'Klamath protected staging published-authority gate failed';
  END IF;

  INSERT INTO public.organization_messaging_connectors (
    id, organization_id, channel, provider, status, priority,
    credential_reference, sender_identity_reference
  ) VALUES (
    messaging_id, klamath_id, 'sms', 'twilio', 'inactive', 100,
    'bluladder-klamath-twilio-production-v1', sms_sender
  );
  GET DIAGNOSTICS connector_rows = ROW_COUNT;

  INSERT INTO public.escalation_recipients (
    id, organization_id, name, phone, email, role, categories,
    handles_urgent, is_enabled, verified_at
  ) VALUES
    (
      transfer_id, klamath_id, 'BluLadder Klamath Transfer', transfer_phone,
      NULL, 'primary', '["transfer_destination"]'::jsonb, true, false, now()
    ),
    (
      alert_id, klamath_id, 'BluLadder Klamath Operational Alerts', alert_phone,
      alert_email, 'backup', '["operational_alert_recipient"]'::jsonb,
      true, false, now()
    );
  GET DIAGNOSTICS recipient_rows = ROW_COUNT;

  IF connector_rows <> 1 OR recipient_rows <> 2
  THEN
    RAISE EXCEPTION 'Klamath protected staging inserted %, % rows',
      connector_rows, recipient_rows;
  END IF;

  IF (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE id = messaging_id AND organization_id = klamath_id
        AND channel = 'sms' AND provider = 'twilio' AND status = 'inactive'
        AND priority = 100
        AND credential_reference = 'bluladder-klamath-twilio-production-v1'
        AND sender_identity_reference = sms_sender) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE id = transfer_id AND organization_id = klamath_id
        AND role = 'primary'
        AND categories = '["transfer_destination"]'::jsonb
        AND is_enabled = false AND verified_at IS NOT NULL
        AND phone = transfer_phone AND email IS NULL) <> 1
    OR (SELECT count(*) FROM public.escalation_recipients
      WHERE id = alert_id AND organization_id = klamath_id
        AND role = 'backup'
        AND categories = '["operational_alert_recipient"]'::jsonb
        AND is_enabled = false AND verified_at IS NOT NULL
        AND phone = alert_phone AND email = alert_email) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND customer_traffic_allowed = false) <> 1
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 166
  THEN
    RAISE EXCEPTION 'Klamath protected staging postcondition failed';
  END IF;
END
$klamath_protected_row_staging$;

COMMIT;
