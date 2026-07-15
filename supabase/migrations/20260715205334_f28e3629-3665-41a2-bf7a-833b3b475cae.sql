-- 1) Extend enums (new values become usable only after this txn commits;
-- plpgsql function bodies below are parsed lazily so they remain valid).
ALTER TYPE public.lead_lifecycle_status ADD VALUE IF NOT EXISTS 'quote_saved';
ALTER TYPE public.lead_lifecycle_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE public.lead_lifecycle_status ADD VALUE IF NOT EXISTS 'rebook_window';
ALTER TYPE public.lead_lifecycle_status ADD VALUE IF NOT EXISTS 'expired';

ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'saved';
ALTER TYPE public.quote_status ADD VALUE IF NOT EXISTS 'emailed';

-- 2) New columns
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3) Update the derived-lifecycle function.
-- Latest action still wins; new rules layered on top.
CREATE OR REPLACE FUNCTION public.compute_customer_lifecycle(p_customer_id uuid)
RETURNS public.lead_lifecycle_status LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  b record; q record; b_ts timestamptz; q_ts timestamptz;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE customer_id = p_customer_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  SELECT * INTO q FROM public.quotes WHERE customer_id = p_customer_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF b.id IS NULL AND q.id IS NULL THEN RETURN NULL; END IF;

  b_ts := COALESCE(b.updated_at, b.created_at);
  q_ts := COALESCE(q.updated_at, q.created_at);

  -- Booking wins when it's the most recent record.
  IF b.id IS NOT NULL AND (q.id IS NULL OR b_ts >= q_ts) THEN
    IF b.status = 'cancelled' THEN RETURN 'declined'; END IF;
    IF b.status = 'completed' THEN RETURN 'completed'; END IF;
    RETURN 'booked';
  END IF;

  -- Quote-driven states.
  IF q.status IN ('declined') THEN RETURN 'declined'; END IF;
  IF q.status = 'converted' THEN RETURN 'booked'; END IF;

  -- Saved-bid expiration takes precedence over the saved status itself.
  IF q.expires_at IS NOT NULL
     AND q.expires_at < now()
     AND q.status::text IN ('saved','emailed','viewed','pending','expired') THEN
    RETURN 'expired';
  END IF;

  IF q.status::text IN ('saved','emailed') THEN RETURN 'quote_saved'; END IF;
  IF q.status = 'expired' THEN RETURN 'expired'; END IF;

  IF public.quote_has_real_services(q.services_json) THEN RETURN 'pending'; END IF;
  RETURN 'open';
END$$;
