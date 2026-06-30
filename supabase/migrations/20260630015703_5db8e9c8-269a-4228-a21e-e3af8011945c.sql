
REVOKE ALL ON FUNCTION public.apply_lifecycle_status(uuid, public.lead_lifecycle_status, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_lifecycle_status(uuid, public.lead_lifecycle_status, text) TO service_role;
REVOKE ALL ON FUNCTION public.compute_customer_lifecycle(uuid) FROM PUBLIC, anon;
