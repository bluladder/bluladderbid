
-- 1. Create a public view for technicians that excludes sensitive fields
CREATE OR REPLACE VIEW public.technicians_public AS
SELECT 
  id, name, is_active, schedule_start_hour, schedule_end_hour, 
  work_days, buffer_minutes, max_drive_time_minutes, service_capabilities, 
  max_stories, jobber_user_id, location_type, skill_level, created_at, updated_at
FROM public.technicians
WHERE is_active = true;

-- 2. Restrict technicians public SELECT to admin only (remove the old public policy)
DROP POLICY IF EXISTS "Public can view active technicians" ON public.technicians;
CREATE POLICY "Authenticated can view active technicians" ON public.technicians
  FOR SELECT TO authenticated
  USING (is_active = true);

-- 3. Restrict technician_service_rates to admin only (remove public SELECT)
DROP POLICY IF EXISTS "Public can view service rates" ON public.technician_service_rates;

-- 4. Tighten bookings INSERT policy to verify customer ownership
DROP POLICY IF EXISTS "Anyone can create booking with valid customer" ON public.bookings;
CREATE POLICY "Authenticated users can create booking for own customer record" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (
    customer_id IS NOT NULL 
    AND reference_number IS NOT NULL 
    AND duration_minutes > 0
    AND customer_id IN (
      SELECT id FROM public.customers 
      WHERE email = (current_setting('request.jwt.claims', true)::json ->> 'email')
    )
  );

-- Keep a separate admin insert policy
CREATE POLICY "Admins can insert any booking" ON public.bookings
  FOR INSERT TO authenticated
  WITH CHECK (is_admin());
