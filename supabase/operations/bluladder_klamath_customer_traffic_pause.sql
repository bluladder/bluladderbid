-- Emergency fail-closed pause for the one live BluLadder Klamath site.
--
-- Execute only when an observed release problem requires customer traffic to
-- stop. This transaction preserves all provider, tenant, migration, and DFW
-- state and changes only customer_traffic_allowed from true to false.

BEGIN;

SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';

LOCK TABLE public.organizations, public.organization_customer_sites
IN SHARE ROW EXCLUSIVE MODE;

DO $klamath_customer_traffic_pause$
DECLARE
  klamath_id constant uuid :=
    'b1addf00-0000-4000-8000-000000000003'::uuid;
  affected_rows integer;
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
    RAISE EXCEPTION 'Klamath traffic pause DFW invariant failed';
  END IF;

  IF (SELECT count(*) FROM public.organizations
      WHERE id = klamath_id
        AND slug = 'bluladder-klamath'
        AND status = 'active'
        AND is_legacy_default = false) <> 1
    OR (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id) <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic pause tenant uniqueness gate failed';
  END IF;

  UPDATE public.organization_customer_sites
  SET customer_traffic_allowed = false, updated_at = now()
  WHERE organization_id = klamath_id
    AND tenant_key = 'bluladder-klamath'
    AND canonical_hostname = 'klamath.bluladder.com'
    AND mapping_status = 'active'
    AND runtime_routing_enabled = true
    AND site_published = true
    AND customer_traffic_allowed = true;

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  IF affected_rows <> 1 THEN
    RAISE EXCEPTION 'Klamath traffic pause affected % rows, expected 1',
      affected_rows;
  END IF;

  IF (SELECT count(*) FROM public.organization_customer_sites
      WHERE organization_id = klamath_id
        AND tenant_key = 'bluladder-klamath'
        AND canonical_hostname = 'klamath.bluladder.com'
        AND mapping_status = 'active'
        AND runtime_routing_enabled = true
        AND site_published = true
        AND customer_traffic_allowed = false) <> 1
  THEN
    RAISE EXCEPTION 'Klamath traffic pause postcondition failed';
  END IF;
END
$klamath_customer_traffic_pause$;

COMMIT;
