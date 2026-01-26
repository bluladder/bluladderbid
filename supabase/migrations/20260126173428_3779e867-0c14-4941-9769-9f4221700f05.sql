-- Add UTM tracking column to bookings table
ALTER TABLE public.bookings 
ADD COLUMN utm_params_json jsonb DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.bookings.utm_params_json IS 'Marketing attribution data captured from URL parameters (utm_source, utm_medium, utm_campaign, utm_term, utm_content, preset)';