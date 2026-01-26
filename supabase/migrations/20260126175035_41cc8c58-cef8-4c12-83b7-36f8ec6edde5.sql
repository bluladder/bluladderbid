-- Create enum for quote status
CREATE TYPE public.quote_status AS ENUM ('pending', 'viewed', 'converted', 'expired', 'declined');

-- Create quotes table for tracking conversion funnel
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Customer info (may not be a full customer yet)
  customer_email text,
  customer_name text,
  customer_phone text,
  customer_id uuid REFERENCES public.customers(id),
  
  -- Quote details
  services_json jsonb NOT NULL,
  home_details_json jsonb NOT NULL,
  subtotal numeric NOT NULL,
  discount_code text,
  discount_amount numeric DEFAULT 0,
  total numeric NOT NULL,
  
  -- Tracking
  utm_params_json jsonb,
  session_id text, -- Anonymous session tracking
  
  -- Status and conversion
  status quote_status NOT NULL DEFAULT 'pending',
  converted_booking_id uuid REFERENCES public.bookings(id),
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  viewed_at timestamptz,
  converted_at timestamptz,
  expires_at timestamptz DEFAULT (now() + interval '30 days'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

-- Indexes for performance
CREATE INDEX idx_quotes_status ON public.quotes(status);
CREATE INDEX idx_quotes_created_at ON public.quotes(created_at);
CREATE INDEX idx_quotes_customer_email ON public.quotes(customer_email);
CREATE INDEX idx_quotes_session_id ON public.quotes(session_id);

-- RLS Policies
CREATE POLICY "Admins can manage quotes"
  ON public.quotes FOR ALL
  USING (is_admin());

CREATE POLICY "Anyone can create quotes"
  ON public.quotes FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Customers can view own quotes by email"
  ON public.quotes FOR SELECT
  USING (
    customer_email = ((current_setting('request.jwt.claims'::text, true))::json ->> 'email')
    OR is_admin()
  );

-- Trigger for updated_at
CREATE TRIGGER update_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();