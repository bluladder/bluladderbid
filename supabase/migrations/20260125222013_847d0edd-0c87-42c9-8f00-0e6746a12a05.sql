-- Drop the overly permissive public read policy
DROP POLICY IF EXISTS "Anyone can read pricing config" ON public.pricing_config;

-- Create a new policy that restricts reads to admins only
CREATE POLICY "Admins can read pricing config"
ON public.pricing_config
FOR SELECT
USING (is_admin());