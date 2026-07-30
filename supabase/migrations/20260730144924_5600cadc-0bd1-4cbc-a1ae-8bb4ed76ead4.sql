DROP POLICY IF EXISTS "Admins manage properties" ON public.properties;
CREATE POLICY "Admins view properties" ON public.properties FOR SELECT TO authenticated USING (has_admin_level(auth.uid(),'read_only_admin'));
CREATE POLICY "Ops admins insert properties" ON public.properties FOR INSERT TO authenticated WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins update properties" ON public.properties FOR UPDATE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin')) WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins delete properties" ON public.properties FOR DELETE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin'));

DROP POLICY IF EXISTS "Admins manage customer_properties" ON public.customer_properties;
CREATE POLICY "Admins view customer_properties" ON public.customer_properties FOR SELECT TO authenticated USING (has_admin_level(auth.uid(),'read_only_admin'));
CREATE POLICY "Ops admins insert customer_properties" ON public.customer_properties FOR INSERT TO authenticated WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins update customer_properties" ON public.customer_properties FOR UPDATE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin')) WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins delete customer_properties" ON public.customer_properties FOR DELETE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin'));

DROP POLICY IF EXISTS "Admins manage property_facts" ON public.property_facts;
CREATE POLICY "Admins view property_facts" ON public.property_facts FOR SELECT TO authenticated USING (has_admin_level(auth.uid(),'read_only_admin'));
CREATE POLICY "Ops admins insert property_facts" ON public.property_facts FOR INSERT TO authenticated WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins update property_facts" ON public.property_facts FOR UPDATE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin')) WITH CHECK (has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Ops admins delete property_facts" ON public.property_facts FOR DELETE TO authenticated USING (has_admin_level(auth.uid(),'operations_admin'));