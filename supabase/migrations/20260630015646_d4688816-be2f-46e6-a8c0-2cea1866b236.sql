
-- ===== Enum =====
CREATE TYPE public.lead_lifecycle_status AS ENUM ('open','pending','approved','booked','declined');

-- ===== Customers: lifecycle columns =====
ALTER TABLE public.customers
  ADD COLUMN lifecycle_status public.lead_lifecycle_status,
  ADD COLUMN lifecycle_changed_at timestamptz,
  ADD COLUMN lifecycle_source text;

-- ===== Campaigns: support lifecycle + keep events =====
ALTER TABLE public.sms_campaigns
  ADD COLUMN campaign_kind text NOT NULL DEFAULT 'event',
  ADD COLUMN lifecycle_status public.lead_lifecycle_status;
ALTER TABLE public.sms_campaigns
  ADD CONSTRAINT sms_campaigns_kind_chk CHECK (campaign_kind IN ('event','lifecycle'));
ALTER TABLE public.sms_campaigns ALTER COLUMN trigger_event DROP NOT NULL;

-- ===== Campaign steps: channel + subject =====
ALTER TABLE public.sms_campaign_steps
  ADD COLUMN channel text NOT NULL DEFAULT 'sms',
  ADD COLUMN subject text;
ALTER TABLE public.sms_campaign_steps
  ADD CONSTRAINT sms_campaign_steps_channel_chk CHECK (channel IN ('sms','email'));

-- ===== Messages: carry both channels =====
ALTER TABLE public.sms_messages
  ADD COLUMN channel text NOT NULL DEFAULT 'sms',
  ADD COLUMN to_email text,
  ADD COLUMN subject text,
  ADD COLUMN customer_id uuid,
  ADD COLUMN enrollment_id uuid;
ALTER TABLE public.sms_messages
  ADD CONSTRAINT sms_messages_channel_chk CHECK (channel IN ('sms','email'));
ALTER TABLE public.sms_messages ALTER COLUMN to_number DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_messages_enrollment ON public.sms_messages(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_sms_messages_customer ON public.sms_messages(customer_id);

-- ===== Enrollments =====
CREATE TABLE public.campaign_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.sms_campaigns(id) ON DELETE CASCADE,
  lifecycle_status public.lead_lifecycle_status,
  status text NOT NULL DEFAULT 'active',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_enrollments_status_chk CHECK (status IN ('active','superseded','completed'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_enrollments TO authenticated;
GRANT ALL ON public.campaign_enrollments TO service_role;
ALTER TABLE public.campaign_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage enrollments" ON public.campaign_enrollments
  FOR ALL TO authenticated
  USING (public.has_admin_level(auth.uid(),'operations_admin'))
  WITH CHECK (public.has_admin_level(auth.uid(),'operations_admin'));
CREATE POLICY "Admins can view enrollments" ON public.campaign_enrollments
  FOR SELECT TO authenticated
  USING (public.has_admin_level(auth.uid(),'read_only_admin'));
CREATE INDEX idx_campaign_enrollments_customer ON public.campaign_enrollments(customer_id);

CREATE TRIGGER trg_campaign_enrollments_updated
  BEFORE UPDATE ON public.campaign_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Helpers =====
CREATE OR REPLACE FUNCTION public.render_msg_template(tmpl text, vars jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k text; v text; out_text text := COALESCE(tmpl,'');
BEGIN
  FOR k, v IN SELECT key, COALESCE(value,'') FROM jsonb_each_text(vars) LOOP
    out_text := replace(out_text, '{{'||k||'}}', v);
    out_text := replace(out_text, '{{ '||k||' }}', v);
  END LOOP;
  out_text := regexp_replace(out_text, '\{\{\s*[\w]+\s*\}\}', '', 'g');
  RETURN out_text;
END$$;

CREATE OR REPLACE FUNCTION public.services_label(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(string_agg(name, ', '), '') FROM (
    SELECT COALESCE(elem->>'name','') AS name
    FROM jsonb_array_elements(
      CASE
        WHEN p IS NULL THEN '[]'::jsonb
        WHEN jsonb_typeof(p)='array' THEN p
        WHEN jsonb_typeof(p->'services')='array' THEN p->'services'
        ELSE '[]'::jsonb
      END
    ) AS elem
    WHERE COALESCE(elem->>'name','') <> ''
  ) s
$$;

CREATE OR REPLACE FUNCTION public.quote_has_real_services(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p IS NULL THEN false
    WHEN jsonb_typeof(p)='array' THEN jsonb_array_length(p) > 0
    WHEN jsonb_typeof(p->'services')='array' THEN jsonb_array_length(p->'services') > 0
    ELSE false
  END
$$;

-- ===== Compute status from quotes/bookings (latest action wins) =====
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

  IF b.id IS NOT NULL AND (q.id IS NULL OR b_ts >= q_ts) THEN
    IF b.status = 'cancelled' THEN RETURN 'declined'; END IF;
    RETURN 'booked';
  ELSE
    IF q.status IN ('declined','expired') THEN RETURN 'declined'; END IF;
    IF q.status = 'converted' THEN RETURN 'booked'; END IF;
    IF public.quote_has_real_services(q.services_json) THEN RETURN 'pending'; END IF;
    RETURN 'open';
  END IF;
END$$;

-- ===== Apply a status: cancel old, enroll new =====
CREATE OR REPLACE FUNCTION public.apply_lifecycle_status(
  p_customer_id uuid, p_status public.lead_lifecycle_status, p_source text DEFAULT 'auto'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cust record; b record; q record; camp record; step record;
  vars jsonb; v_link text; v_enroll uuid;
  app_url text := 'https://bluladderbid.lovable.app';
BEGIN
  SELECT * INTO cust FROM public.customers WHERE id = p_customer_id;
  IF cust.id IS NULL THEN RETURN; END IF;

  SELECT * INTO b FROM public.bookings WHERE customer_id = p_customer_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;
  SELECT * INTO q FROM public.quotes WHERE customer_id = p_customer_id
    ORDER BY updated_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF q.id IS NOT NULL THEN v_link := app_url || '/quote/' || q.id;
  ELSIF b.id IS NOT NULL THEN v_link := app_url || '/my-appointments';
  ELSE v_link := app_url; END IF;

  vars := jsonb_build_object(
    'first_name', COALESCE(cust.first_name,'there'),
    'name', NULLIF(trim(COALESCE(cust.first_name,'') || ' ' || COALESCE(cust.last_name,'')),''),
    'service', COALESCE(public.services_label(COALESCE(b.services_json, q.services_json)),'your service'),
    'link', v_link,
    'total', COALESCE(to_char(COALESCE(b.total, q.total), 'FM$999G999D00'),''),
    'date', COALESCE(to_char(b.scheduled_start AT TIME ZONE 'America/Chicago', 'Dy, Mon DD'),''),
    'time', COALESCE(to_char(b.scheduled_start AT TIME ZONE 'America/Chicago', 'FMHH12:MI AM'),'')
  );

  -- Cancel still-unsent lifecycle messages from prior enrollments
  UPDATE public.sms_messages m
    SET status = 'cancelled', error = 'Superseded by lifecycle status change'
    WHERE m.status = 'pending' AND m.message_kind = 'lifecycle' AND m.customer_id = p_customer_id;

  UPDATE public.campaign_enrollments
    SET status = 'superseded', updated_at = now()
    WHERE customer_id = p_customer_id AND status = 'active';

  UPDATE public.customers
    SET lifecycle_status = p_status, lifecycle_changed_at = now(),
        lifecycle_source = p_source, updated_at = now()
    WHERE id = p_customer_id;

  FOR camp IN
    SELECT * FROM public.sms_campaigns
     WHERE campaign_kind = 'lifecycle' AND active = true AND lifecycle_status = p_status
  LOOP
    INSERT INTO public.campaign_enrollments(customer_id, campaign_id, lifecycle_status, status)
      VALUES (p_customer_id, camp.id, p_status, 'active') RETURNING id INTO v_enroll;

    FOR step IN
      SELECT * FROM public.sms_campaign_steps
       WHERE campaign_id = camp.id AND active = true ORDER BY step_order
    LOOP
      IF step.channel = 'sms' AND cust.phone IS NOT NULL THEN
        INSERT INTO public.sms_messages(
          to_number, channel, body, message_kind, status, customer_id,
          campaign_id, campaign_step_id, enrollment_id, send_at)
        VALUES (
          cust.phone, 'sms', public.render_msg_template(step.body_template, vars),
          'lifecycle', 'pending', p_customer_id, camp.id, step.id, v_enroll,
          now() + (step.delay_hours * interval '1 hour'));
      ELSIF step.channel = 'email' AND cust.email IS NOT NULL THEN
        INSERT INTO public.sms_messages(
          to_email, channel, subject, body, message_kind, status, customer_id,
          campaign_id, campaign_step_id, enrollment_id, send_at)
        VALUES (
          cust.email, 'email', public.render_msg_template(step.subject, vars),
          public.render_msg_template(step.body_template, vars),
          'lifecycle', 'pending', p_customer_id, camp.id, step.id, v_enroll,
          now() + (step.delay_hours * interval '1 hour'));
      END IF;
    END LOOP;
  END LOOP;
END$$;

-- ===== Admin manual switch =====
CREATE OR REPLACE FUNCTION public.admin_set_lifecycle(p_customer_id uuid, p_status public.lead_lifecycle_status)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_admin_level(auth.uid(),'operations_admin') THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  PERFORM public.apply_lifecycle_status(p_customer_id, p_status, 'admin');
END$$;
GRANT EXECUTE ON FUNCTION public.admin_set_lifecycle(uuid, public.lead_lifecycle_status) TO authenticated;

-- ===== Auto-recompute trigger =====
CREATE OR REPLACE FUNCTION public.tg_recompute_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_customer uuid; v_new public.lead_lifecycle_status; v_current public.lead_lifecycle_status;
BEGIN
  v_customer := COALESCE(NEW.customer_id, OLD.customer_id);
  IF v_customer IS NULL THEN RETURN NEW; END IF;
  v_new := public.compute_customer_lifecycle(v_customer);
  IF v_new IS NULL THEN RETURN NEW; END IF;
  SELECT lifecycle_status INTO v_current FROM public.customers WHERE id = v_customer;
  IF v_current IS DISTINCT FROM v_new THEN
    PERFORM public.apply_lifecycle_status(v_customer, v_new, 'auto');
  END IF;
  RETURN NEW;
END$$;

CREATE TRIGGER trg_quotes_lifecycle
  AFTER INSERT OR UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_lifecycle();
CREATE TRIGGER trg_bookings_lifecycle
  AFTER INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_lifecycle();
