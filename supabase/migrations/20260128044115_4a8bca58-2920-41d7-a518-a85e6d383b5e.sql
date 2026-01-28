-- PART 2: Create helper functions and update schedule_blocks table

-- Create a helper function to check specific admin levels
CREATE OR REPLACE FUNCTION public.has_admin_level(_user_id uuid, _min_level text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Hierarchy: owner_admin > admin > operations_admin > read_only_admin > user
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND (
        -- Owner admin has all permissions
        role = 'owner_admin'
        OR role = 'admin' -- Legacy admin also has full access
        OR (
          _min_level = 'operations_admin' AND role IN ('operations_admin', 'owner_admin', 'admin')
        )
        OR (
          _min_level = 'read_only_admin' AND role IN ('read_only_admin', 'operations_admin', 'owner_admin', 'admin')
        )
      )
  );
END;
$$;

-- Create function to check if user can edit crew rules
CREATE OR REPLACE FUNCTION public.can_edit_crew_rules()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_level(auth.uid(), 'operations_admin')
$$;

-- Create function to check if user can override bookings
CREATE OR REPLACE FUNCTION public.can_override_bookings()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_level(auth.uid(), 'operations_admin')
$$;

-- Create function to check if user can manage schedule blocks
CREATE OR REPLACE FUNCTION public.can_manage_schedule_blocks()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_admin_level(auth.uid(), 'operations_admin')
$$;

-- Create function to check if user is read-only admin
CREATE OR REPLACE FUNCTION public.is_read_only_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'read_only_admin'
  ) AND NOT public.has_admin_level(auth.uid(), 'operations_admin')
$$;

-- Add additional fields to schedule_blocks for better categorization
ALTER TABLE schedule_blocks 
ADD COLUMN IF NOT EXISTS block_category text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS is_all_day boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS notes text;

-- Update RLS policy for schedule_blocks to use granular permissions
DROP POLICY IF EXISTS "Admins can manage schedule blocks" ON schedule_blocks;

CREATE POLICY "Operations+ admins can manage schedule blocks"
ON schedule_blocks
FOR ALL
USING (can_manage_schedule_blocks());

-- Read-only admins can only view
CREATE POLICY "Read-only admins can view schedule blocks"
ON schedule_blocks
FOR SELECT
USING (is_read_only_admin());