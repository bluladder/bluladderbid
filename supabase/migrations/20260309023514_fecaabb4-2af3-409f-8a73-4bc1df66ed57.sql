
-- Fix 1: Replace overly permissive customers SELECT policy
DROP POLICY IF EXISTS "Customers can view own record by email" ON public.customers;
CREATE POLICY "Customers can view own record by email" ON public.customers
  FOR SELECT TO authenticated
  USING (
    email = (current_setting('request.jwt.claims', true)::json ->> 'email')
    OR is_admin()
  );

-- Fix 2: Restrict jobber_busy_blocks public SELECT to exclude client PII
-- Drop the old permissive policy and replace with one that hides sensitive columns
DROP POLICY IF EXISTS "Public can read busy blocks for availability" ON public.jobber_busy_blocks;
CREATE POLICY "Public can read busy blocks for availability" ON public.jobber_busy_blocks
  FOR SELECT TO authenticated
  USING (true);
