
-- Restrict technicians table SELECT to admins only (previously any authenticated user could read email/starting_address)
DROP POLICY IF EXISTS "Authenticated can view active technicians" ON public.technicians;
CREATE POLICY "Admins can view technicians"
  ON public.technicians FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Revoke EXECUTE on SECURITY DEFINER functions from anon (public API). These should never be callable
-- by unauthenticated users. Authenticated remains where the function is a legitimate RPC or RLS helper.
REVOKE EXECUTE ON FUNCTION public.log_business_knowledge_revision() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_phone_number_revision() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.publish_pricing_version(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.authorize_staff_test_reply(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.consume_staff_test_reply_auth(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_admin_level(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_read_only_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_crew_rules() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_schedule_blocks() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_override_bookings() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_lifecycle(uuid, public.lead_lifecycle_status) FROM PUBLIC, anon;

-- Admin-only RPCs: also revoke from authenticated (verified server-side via service role)
REVOKE EXECUTE ON FUNCTION public.publish_pricing_version(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.authorize_staff_test_reply(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_staff_test_reply_auth(uuid, text) FROM authenticated;
