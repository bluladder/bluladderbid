-- Read-only preflight for the three-row Klamath protected-authority staging.

BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

WITH k AS (
  SELECT 'b1addf00-0000-4000-8000-000000000003'::uuid AS id
), dfw AS (
  SELECT 'b1addf00-0000-4000-8000-000000000001'::uuid AS id
), ledger AS (
  SELECT count(*) AS ledger_count, max(version) AS ledger_tip,
    count(*) FILTER (WHERE version = '20260815103000') AS superseded_count,
    count(*) FILTER (WHERE version = '20260822170000') AS replacement_count
  FROM supabase_migrations.schema_migrations
), target AS (
  SELECT
    (SELECT count(*) FROM public.organization_messaging_connectors
      WHERE organization_id = (SELECT id FROM k)) AS sms_connector_count,
    (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = (SELECT id FROM k)
        AND categories = '["transfer_destination"]'::jsonb)
      AS transfer_destination_count,
    (SELECT count(*) FROM public.escalation_recipients
      WHERE organization_id = (SELECT id FROM k)
        AND categories = '["operational_alert_recipient"]'::jsonb)
      AS operational_alert_count
), tenant AS (
  SELECT
    (SELECT count(*) FROM public.organizations
      WHERE id = (SELECT id FROM k) AND slug = 'bluladder-klamath'
        AND status = 'provisioning' AND is_legacy_default = false)
      AS exact_klamath_count,
    (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = (SELECT id FROM k)
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'provisioning'
        AND runtime_routing_enabled = false AND site_published = false
        AND customer_traffic_allowed = false) AS inactive_site_count,
    (SELECT count(*) FROM public.organizations
      WHERE id = (SELECT id FROM dfw) AND slug = 'bluladder-dfw'
        AND status = 'active' AND is_legacy_default = true) AS exact_dfw_count
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
  'ledger_count', ledger.ledger_count, 'ledger_tip', ledger.ledger_tip,
  'superseded_count', ledger.superseded_count,
  'replacement_count', ledger.replacement_count,
  'sms_connector_count', target.sms_connector_count,
  'transfer_destination_count', target.transfer_destination_count,
  'operational_alert_count', target.operational_alert_count,
  'exact_klamath_count', tenant.exact_klamath_count,
  'inactive_site_count', tenant.inactive_site_count,
  'exact_dfw_count', tenant.exact_dfw_count,
  'dfw_counts', dfw_state.counts,
  'dfw_counts_sha256', encode(digest(dfw_state.counts::text, 'sha256'), 'hex')
) AS bluladder_klamath_protected_row_staging_preflight
FROM ledger, target, tenant, dfw_state;

ROLLBACK;
