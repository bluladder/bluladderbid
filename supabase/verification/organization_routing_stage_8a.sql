-- Read-only verification for Issue #8 Stage 8A.
-- Run only after the migration has been separately authorized and applied.

SELECT table_name, is_insertable_into
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
ORDER BY table_name;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
ORDER BY c.relname;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'organization_settings',
    'organization_contacts',
    'organization_territories',
    'organization_services'
  )
ORDER BY tablename, policyname;

SELECT o.id, o.slug, o.status, o.is_legacy_default,
       count(t.id) FILTER (WHERE t.status = 'active') AS active_territories,
       count(s.id) FILTER (WHERE s.status = 'active') AS active_services,
       count(c.id) FILTER (WHERE c.status = 'active') AS active_contacts
FROM public.organizations o
LEFT JOIN public.organization_territories t ON t.organization_id = o.id
LEFT JOIN public.organization_services s ON s.organization_id = o.id
LEFT JOIN public.organization_contacts c ON c.organization_id = o.id
WHERE o.id IN (
  'b1addf00-0000-4000-8000-000000000001',
  'b1addf00-0000-4000-8000-000000000002'
)
GROUP BY o.id, o.slug, o.status, o.is_legacy_default
ORDER BY o.id;

-- Required invariant: one row, with provisioning/false and all active counts 0.
SELECT o.id, o.status, o.is_legacy_default,
       count(t.id) FILTER (WHERE t.status = 'active') AS active_territories
FROM public.organizations o
LEFT JOIN public.organization_territories t ON t.organization_id = o.id
WHERE o.id = 'b1addf00-0000-4000-8000-000000000002'
GROUP BY o.id, o.status, o.is_legacy_default;

