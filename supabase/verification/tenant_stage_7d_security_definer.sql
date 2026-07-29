-- Read-only verification for 20260728080000_restrict_security_definer_execution.sql.
-- Run only after the migration is separately authorized and applied.

BEGIN TRANSACTION READ ONLY;

-- Must return two rows with every role-specific EXECUTE result false.
SELECT
  p.oid::regprocedure::text AS signature,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'audit_business_knowledge',
    'persist_booking_lead_attribution'
  )
ORDER BY p.proname;

-- Must return one row: anon/authenticated/service_role true, PUBLIC false,
-- SECURITY DEFINER true, and search_path=public.
SELECT
  p.oid::regprocedure::text AS signature,
  p.prosecdef AS security_definer,
  p.proconfig AS configuration,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'search_published_business_knowledge';

-- Must return the two expected trigger bindings.
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  p.oid::regprocedure::text AS function_signature
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND p.proname IN (
    'audit_business_knowledge',
    'persist_booking_lead_attribution'
  )
ORDER BY c.relname, t.tgname;

ROLLBACK;
