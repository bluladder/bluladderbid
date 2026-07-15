
-- Attribution events (one row per anonymous session)
CREATE TABLE IF NOT EXISTS public.attribution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_session_id text UNIQUE NOT NULL,
  first_touch jsonb,
  last_touch jsonb,
  landing_page_slug text,
  fbclid text,
  referrer text,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  jobber_client_id text,
  jobber_job_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.attribution_events TO authenticated;
GRANT ALL ON public.attribution_events TO service_role;

ALTER TABLE public.attribution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view attribution events"
  ON public.attribution_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_attribution_events_created_at ON public.attribution_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attribution_events_landing_slug ON public.attribution_events(landing_page_slug);
CREATE INDEX IF NOT EXISTS idx_attribution_events_fbclid ON public.attribution_events(fbclid);

CREATE TRIGGER attribution_events_updated_at
  BEFORE UPDATE ON public.attribution_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend quotes with attribution + revenue snapshot columns
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS attribution jsonb,
  ADD COLUMN IF NOT EXISTS source_session_id text,
  ADD COLUMN IF NOT EXISTS estimated_quote_revenue numeric(10,2),
  ADD COLUMN IF NOT EXISTS quote_completion_seconds integer;

CREATE INDEX IF NOT EXISTS idx_quotes_source_session_id ON public.quotes(source_session_id);

-- Extend bookings with attribution + booked revenue columns and dedup registry
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS attribution jsonb,
  ADD COLUMN IF NOT EXISTS source_session_id text,
  ADD COLUMN IF NOT EXISTS booked_revenue numeric(10,2),
  ADD COLUMN IF NOT EXISTS booked_subtotal numeric(10,2),
  ADD COLUMN IF NOT EXISTS booked_discount_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS booked_bundle_savings numeric(10,2),
  ADD COLUMN IF NOT EXISTS booked_service_count integer,
  ADD COLUMN IF NOT EXISTS booked_services jsonb,
  ADD COLUMN IF NOT EXISTS booking_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS quote_to_booking_seconds integer,
  ADD COLUMN IF NOT EXISTS meta_events_fired jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_bookings_source_session_id ON public.bookings(source_session_id);

-- Marketing funnel view (admin-only via underlying RLS on bookings/quotes)
CREATE OR REPLACE VIEW public.admin_marketing_funnel AS
SELECT
  ae.id                                       AS attribution_id,
  ae.source_session_id,
  ae.landing_page_slug,
  ae.fbclid,
  ae.referrer,
  ae.first_touch,
  ae.last_touch,
  (ae.first_touch ->> 'utm_source')           AS utm_source,
  (ae.first_touch ->> 'utm_medium')           AS utm_medium,
  (ae.first_touch ->> 'utm_campaign')         AS utm_campaign,
  (ae.first_touch ->> 'utm_content')          AS utm_content,
  (ae.first_touch ->> 'utm_term')             AS utm_term,
  ae.created_at                               AS visitor_at,
  q.id                                        AS quote_id,
  q.total                                     AS quoted_total,
  q.estimated_quote_revenue,
  q.created_at                                AS quote_created_at,
  q.status                                    AS quote_status,
  b.id                                        AS booking_id,
  b.jobber_job_id,
  b.jobber_visit_id,
  b.booked_revenue,
  b.booked_subtotal,
  b.booked_discount_amount,
  b.booked_bundle_savings,
  b.booked_service_count,
  b.booked_services,
  b.booking_completed_at,
  b.status                                    AS booking_status,
  (b.home_details_json ->> 'city')            AS city,
  (b.home_details_json ->> 'zipCode')         AS zip_code
FROM public.attribution_events ae
LEFT JOIN public.quotes q ON q.id = ae.quote_id
LEFT JOIN public.bookings b ON b.id = ae.booking_id;

GRANT SELECT ON public.admin_marketing_funnel TO authenticated;
