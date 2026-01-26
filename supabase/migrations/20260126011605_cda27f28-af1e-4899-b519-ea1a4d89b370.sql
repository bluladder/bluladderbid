-- Add RLS policies for users to manage their own scenarios
-- This allows non-admin users to view, create, update, and delete their own scenarios

-- Policy for users to view their own scenarios
CREATE POLICY "Users can view their own scenarios"
ON public.saved_scenarios
FOR SELECT
USING (auth.uid() = created_by);

-- Policy for users to create their own scenarios
CREATE POLICY "Users can create their own scenarios"
ON public.saved_scenarios
FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- Policy for users to update their own scenarios
CREATE POLICY "Users can update their own scenarios"
ON public.saved_scenarios
FOR UPDATE
USING (auth.uid() = created_by);

-- Policy for users to delete their own scenarios
CREATE POLICY "Users can delete their own scenarios"
ON public.saved_scenarios
FOR DELETE
USING (auth.uid() = created_by);