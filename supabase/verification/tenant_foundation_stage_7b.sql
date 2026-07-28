-- Read-only verification for 20260728060000_tenant_foundation_stage_7b.sql.
-- Run after migration application in a reviewed environment. Every query must
-- return zero rows or the exact count/value stated in its comment.

-- Exactly one canonical DFW row.
SELECT id, slug, status, is_legacy_default
FROM public.organizations
WHERE id = 'b1addf00-0000-4000-8000-000000000001';

-- Must return 0: first-wave legacy backfill completeness.
SELECT table_name, null_count
FROM (
  SELECT 'customers' AS table_name, count(*) AS null_count
  FROM public.customers WHERE organization_id IS NULL
  UNION ALL
  SELECT 'properties', count(*) FROM public.properties WHERE organization_id IS NULL
  UNION ALL
  SELECT 'quotes', count(*) FROM public.quotes WHERE organization_id IS NULL
  UNION ALL
  SELECT 'bookings', count(*) FROM public.bookings WHERE organization_id IS NULL
) counts
WHERE null_count > 0;

-- Must return 0: parent/child organization mismatches.
SELECT b.id, b.organization_id AS child_org, c.organization_id AS parent_org
FROM public.bookings b
JOIN public.customers c ON c.id = b.customer_id
WHERE b.organization_id IS DISTINCT FROM c.organization_id
UNION ALL
SELECT q.id, q.organization_id, c.organization_id
FROM public.quotes q
JOIN public.customers c ON c.id = q.customer_id
WHERE q.organization_id IS DISTINCT FROM c.organization_id;

-- Must return 0: active resolution keys that are not globally unique.
SELECT key_type, key_hash, count(*)
FROM public.organization_resolution_keys
WHERE status = 'active'
GROUP BY key_type, key_hash
HAVING count(*) > 1;

-- Must return 0: migrated platform users without DFW membership.
SELECT ur.user_id
FROM public.user_roles ur
LEFT JOIN public.organization_memberships om
  ON om.user_id = ur.user_id
 AND om.organization_id = 'b1addf00-0000-4000-8000-000000000001'
 AND om.status = 'active'
WHERE om.id IS NULL;

-- Hosted reconciliation: inspect these before expanding the first wave.
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('big_job_settings', 'eligibility_rules', 'schedule_blocks')
ORDER BY table_name;
