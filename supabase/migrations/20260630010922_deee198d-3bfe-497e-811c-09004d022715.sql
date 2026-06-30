-- 1. Move pg_net extension out of the public schema.
-- pg_net does not support ALTER ... SET SCHEMA, so drop and recreate it in a
-- dedicated extensions schema. Its callable functions live in the `net` schema
-- regardless, so existing cron jobs calling net.http_post keep working.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
DROP EXTENSION IF EXISTS pg_net;
CREATE EXTENSION pg_net WITH SCHEMA extensions;

-- 2. Remove always-true RLS policies.
-- The service_role policies are redundant (service_role bypasses RLS), and the
-- drive_time_cache "manage" policy was scoped to public, allowing anyone to write.

-- drive_time_cache: was open to PUBLIC for ALL with USING(true)/WITH CHECK(true)
DROP POLICY IF EXISTS "Service role can manage cache" ON public.drive_time_cache;

-- notification_events: redundant service_role ALL policy
DROP POLICY IF EXISTS "Service role can manage notification events" ON public.notification_events;

-- pending_confirmations: redundant service_role ALL policy
DROP POLICY IF EXISTS "Service role can manage pending confirmations" ON public.pending_confirmations;

-- booking_audit_log: redundant service_role INSERT policy
DROP POLICY IF EXISTS "Service role can insert audit logs" ON public.booking_audit_log;