-- Drop the overly permissive policy
DROP POLICY "Anyone can create quotes" ON public.quotes;

-- Create a more restrictive policy with validation
CREATE POLICY "Anyone can create quotes with valid data"
  ON public.quotes FOR INSERT
  WITH CHECK (
    services_json IS NOT NULL 
    AND home_details_json IS NOT NULL 
    AND total > 0
  );