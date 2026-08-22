-- Read-only verification after the protected rows are staged. Raw private
-- values are represented only by non-reversible fingerprints.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH k AS (
  SELECT 'b1addf00-0000-4000-8000-000000000003'::uuid AS id
), dfw AS (
  SELECT 'b1addf00-0000-4000-8000-000000000001'::uuid AS id
), connector AS (
  SELECT count(*) AS total_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000007001'::uuid
        AND channel = 'sms' AND provider = 'twilio' AND status = 'inactive'
        AND priority = 100
        AND credential_reference = 'bluladder-klamath-twilio-production-v1'
        AND sender_identity_reference ~ '^MG[0-9a-f]{32}$'
    ) AS exact_inactive_count,
    encode(digest(coalesce(min(sender_identity_reference), ''), 'sha256'), 'hex')
      AS sender_identity_sha256
  FROM public.organization_messaging_connectors
  WHERE organization_id = (SELECT id FROM k)
), recipients AS (
  SELECT count(*) AS total_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000006001'::uuid
        AND role = 'primary'
        AND categories = '["transfer_destination"]'::jsonb
        AND is_enabled = false AND verified_at IS NOT NULL AND email IS NULL
    ) AS exact_transfer_count,
    count(*) FILTER (
      WHERE id = 'b1addf00-0000-4000-8000-000000006002'::uuid
        AND role = 'backup'
        AND categories = '["operational_alert_recipient"]'::jsonb
        AND is_enabled = false AND verified_at IS NOT NULL AND email IS NOT NULL
    ) AS exact_alert_count,
    count(DISTINCT phone) AS distinct_phone_count,
    max(encode(digest(phone, 'sha256'), 'hex')) FILTER (
      WHERE categories = '["transfer_destination"]'::jsonb
    ) AS transfer_phone_sha256,
    max(encode(digest(phone, 'sha256'), 'hex')) FILTER (
      WHERE categories = '["operational_alert_recipient"]'::jsonb
    ) AS alert_phone_sha256,
    max(encode(digest(lower(email), 'sha256'), 'hex')) FILTER (
      WHERE categories = '["operational_alert_recipient"]'::jsonb
    ) AS alert_email_sha256
  FROM public.escalation_recipients
  WHERE organization_id = (SELECT id FROM k)
), ledger AS (
  SELECT count(*) AS ledger_count, max(version) AS ledger_tip
  FROM supabase_migrations.schema_migrations
), tenant AS (
  SELECT count(*) AS disabled_site_count
  FROM public.organization_customer_sites
  WHERE organization_id = (SELECT id FROM k)
    AND mapping_status = 'provisioning' AND runtime_routing_enabled = false
    AND site_published = false AND customer_traffic_allowed = false
), dfw_state AS (
  SELECT jsonb_build_object(
    'organizations', (SELECT count(*) FROM public.organizations
      WHERE id = (SELECT id FROM dfw)),
    'sites', (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = (SELECT id FROM dfw)),
    'resolution_keys', (SELECT count(*) FROM public.organization_resolution_keys
      WHERE organization_id = (SELECT id FROM dfw)),
    'messaging_connectors', (SELECT count(*)
      FROM public.organization_messaging_connectors
      WHERE organization_id = (SELECT id FROM dfw)),
    'escalation_recipients', (SELECT count(*)
      FROM public.escalation_recipients
      WHERE organization_id = (SELECT id FROM dfw))
  ) AS counts
)
SELECT jsonb_build_object(
  'sms_connector_total', connector.total_count,
  'exact_inactive_sms_connector_count', connector.exact_inactive_count,
  'sender_identity_sha256', connector.sender_identity_sha256,
  'protected_recipient_total', recipients.total_count,
  'exact_inactive_transfer_count', recipients.exact_transfer_count,
  'exact_inactive_alert_count', recipients.exact_alert_count,
  'distinct_phone_count', recipients.distinct_phone_count,
  'transfer_phone_sha256', recipients.transfer_phone_sha256,
  'alert_phone_sha256', recipients.alert_phone_sha256,
  'alert_email_sha256', recipients.alert_email_sha256,
  'disabled_site_count', tenant.disabled_site_count,
  'ledger_count', ledger.ledger_count, 'ledger_tip', ledger.ledger_tip,
  'dfw_counts', dfw_state.counts,
  'dfw_counts_sha256', encode(digest(dfw_state.counts::text, 'sha256'), 'hex')
) AS bluladder_klamath_protected_row_staging_postflight
FROM connector, recipients, ledger, tenant, dfw_state;

ROLLBACK;
