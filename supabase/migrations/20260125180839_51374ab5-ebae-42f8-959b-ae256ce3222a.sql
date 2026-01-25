-- Create table for saved admin scenarios
CREATE TABLE public.saved_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  home_details JSONB NOT NULL,
  additional_services JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.saved_scenarios ENABLE ROW LEVEL SECURITY;

-- Only admins can manage scenarios
CREATE POLICY "Admins can view all scenarios"
  ON public.saved_scenarios FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can create scenarios"
  ON public.saved_scenarios FOR INSERT
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update scenarios"
  ON public.saved_scenarios FOR UPDATE
  USING (public.is_admin());

CREATE POLICY "Admins can delete scenarios"
  ON public.saved_scenarios FOR DELETE
  USING (public.is_admin());

-- Add trigger for updated_at
CREATE TRIGGER update_saved_scenarios_updated_at
  BEFORE UPDATE ON public.saved_scenarios
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster lookups
CREATE INDEX idx_saved_scenarios_created_by ON public.saved_scenarios(created_by);
CREATE INDEX idx_saved_scenarios_name ON public.saved_scenarios(name);