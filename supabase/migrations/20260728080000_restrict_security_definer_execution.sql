-- Stage 7D: narrow direct invocation of reviewed SECURITY DEFINER functions.
-- Repository-only forward migration. Do not apply outside an authorized window.

BEGIN;

-- Trigger functions are invoked by PostgreSQL through their owning triggers.
-- They are not application RPCs and require no direct EXECUTE grant.
REVOKE ALL ON FUNCTION public.audit_business_knowledge()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.persist_booking_lead_attribution()
  FROM PUBLIC, anon, authenticated, service_role;

-- This function is an intentional read-only RPC. Preserve the existing
-- anonymous/authenticated application contract, make it explicit, and retain
-- service-role access for server-side orchestration.
REVOKE ALL ON FUNCTION public.search_published_business_knowledge(text, integer)
  FROM PUBLIC;
GRANT EXECUTE
  ON FUNCTION public.search_published_business_knowledge(text, integer)
  TO anon, authenticated, service_role;

COMMIT;
