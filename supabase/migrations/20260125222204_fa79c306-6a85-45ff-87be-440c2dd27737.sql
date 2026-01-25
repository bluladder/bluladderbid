-- Create discount codes table
CREATE TABLE public.discount_codes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    description TEXT,
    discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC NOT NULL CHECK (discount_value > 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    expires_at TIMESTAMP WITH TIME ZONE,
    usage_count INTEGER NOT NULL DEFAULT 0,
    max_uses INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for management
CREATE POLICY "Admins can view all discount codes"
ON public.discount_codes
FOR SELECT
USING (is_admin());

CREATE POLICY "Admins can insert discount codes"
ON public.discount_codes
FOR INSERT
WITH CHECK (is_admin());

CREATE POLICY "Admins can update discount codes"
ON public.discount_codes
FOR UPDATE
USING (is_admin());

CREATE POLICY "Admins can delete discount codes"
ON public.discount_codes
FOR DELETE
USING (is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_discount_codes_updated_at
BEFORE UPDATE ON public.discount_codes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();