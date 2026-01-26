-- =============================================
-- JOBBER INTEGRATION SCHEMA
-- =============================================

-- Store Jobber OAuth tokens (single admin connection)
CREATE TABLE public.jobber_oauth_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scope text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.jobber_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Only admins can manage OAuth tokens
CREATE POLICY "Admins can manage OAuth tokens"
ON public.jobber_oauth_tokens
FOR ALL
USING (public.is_admin());

-- =============================================
-- TECHNICIANS TABLE
-- =============================================
CREATE TABLE public.technicians (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jobber_user_id text UNIQUE NOT NULL,
    name text NOT NULL,
    email text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;

-- Public read for availability display, admin write
CREATE POLICY "Public can view active technicians"
ON public.technicians
FOR SELECT
USING (is_active = true);

CREATE POLICY "Admins can manage technicians"
ON public.technicians
FOR ALL
USING (public.is_admin());

-- =============================================
-- SERVICE TYPES ENUM
-- =============================================
CREATE TYPE public.service_type AS ENUM (
    'windows_exterior',
    'windows_interior',
    'gutters',
    'house_wash',
    'roof_wash',
    'driveway',
    'pressure_wash_addon'
);

-- =============================================
-- TECHNICIAN SERVICE RATES (Duration Engine)
-- =============================================
CREATE TABLE public.technician_service_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    technician_id uuid NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
    service_type public.service_type NOT NULL,
    dollars_per_hour numeric(10,2) NOT NULL DEFAULT 0,
    buffer_minutes integer NOT NULL DEFAULT 0,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (technician_id, service_type)
);

ALTER TABLE public.technician_service_rates ENABLE ROW LEVEL SECURITY;

-- Public read for duration calculation, admin write
CREATE POLICY "Public can view service rates"
ON public.technician_service_rates
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage service rates"
ON public.technician_service_rates
FOR ALL
USING (public.is_admin());

-- =============================================
-- CUSTOMERS TABLE (link to Jobber)
-- =============================================
CREATE TABLE public.customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    phone text,
    first_name text,
    last_name text,
    address text,
    jobber_client_id text,
    auth_user_id uuid,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    UNIQUE (email)
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

-- Customers can view/update their own record
CREATE POLICY "Public can create customers"
ON public.customers
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Customers can view own record by email"
ON public.customers
FOR SELECT
USING (true);

CREATE POLICY "Admins can manage customers"
ON public.customers
FOR ALL
USING (public.is_admin());

-- =============================================
-- BOOKINGS TABLE
-- =============================================
CREATE TYPE public.booking_status AS ENUM (
    'pending',
    'confirmed',
    'scheduled',
    'in_progress',
    'completed',
    'cancelled'
);

CREATE TABLE public.bookings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    technician_id uuid REFERENCES public.technicians(id),
    
    -- Jobber references
    jobber_job_id text,
    jobber_quote_id text,
    jobber_visit_id text,
    
    -- Booking details
    reference_number text UNIQUE NOT NULL,
    status public.booking_status NOT NULL DEFAULT 'pending',
    scheduled_start timestamp with time zone,
    scheduled_end timestamp with time zone,
    duration_minutes integer NOT NULL,
    
    -- Quote snapshot
    services_json jsonb NOT NULL,
    home_details_json jsonb NOT NULL,
    subtotal numeric(10,2) NOT NULL,
    discount_amount numeric(10,2) DEFAULT 0,
    total numeric(10,2) NOT NULL,
    discount_code text,
    
    -- Notes for Jobber
    notes text,
    
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Customers can view their own bookings
CREATE POLICY "Customers can view own bookings"
ON public.bookings
FOR SELECT
USING (
    customer_id IN (
        SELECT id FROM public.customers WHERE email = current_setting('request.jwt.claims', true)::json->>'email'
    )
);

CREATE POLICY "Public can create bookings"
ON public.bookings
FOR INSERT
WITH CHECK (true);

CREATE POLICY "Admins can manage bookings"
ON public.bookings
FOR ALL
USING (public.is_admin());

-- =============================================
-- TRIGGERS FOR updated_at
-- =============================================
CREATE TRIGGER update_jobber_oauth_tokens_updated_at
BEFORE UPDATE ON public.jobber_oauth_tokens
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_technicians_updated_at
BEFORE UPDATE ON public.technicians
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_technician_service_rates_updated_at
BEFORE UPDATE ON public.technician_service_rates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
BEFORE UPDATE ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- HELPER FUNCTION: Generate reference number
-- =============================================
CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    ref text;
BEGIN
    ref := 'BL-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(gen_random_uuid()::text, 1, 4));
    RETURN ref;
END;
$$;