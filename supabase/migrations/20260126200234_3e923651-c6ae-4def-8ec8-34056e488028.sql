-- Fix: Remove overly permissive policy (service_role bypasses RLS anyway)
DROP POLICY IF EXISTS "Service role can manage cache" ON public.availability_cache;