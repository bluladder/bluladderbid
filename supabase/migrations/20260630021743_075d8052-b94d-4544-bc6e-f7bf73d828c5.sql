CREATE TABLE public.campaign_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  actor_id uuid,
  source text NOT NULL DEFAULT 'auto',
  event_type text NOT NULL DEFAULT 'status_change',
  old_status public.lead_lifecycle_status,
  new_status public.lead_lifecycle_status,
  campaigns_enrolled jsonb NOT NULL DEFAULT '[]'::jsonb,
  messages_cancelled integer NOT NULL DEFAULT 0,
  messages_started integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_audit_log TO authenticated;
GRANT ALL ON public.campaign_audit_log TO service_role;

ALTER TABLE public.campaign_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view campaign audit log"
ON public.campaign_audit_log
FOR SELECT
TO authenticated
USING (public.has_admin_level(auth.uid(), 'read_only_admin'));

CREATE INDEX idx_campaign_audit_customer ON public.campaign_audit_log(customer_id);
CREATE INDEX idx_campaign_audit_created ON public.campaign_audit_log(created_at DESC);

-- Update lifecycle apply logic to write audit entries
CREATE OR REPLACE FUNCTION public.apply_lifecycle_status(p_customer_id uuid, p_status lead_lifecycle_status, p_source text DEFAULT 'auto'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cust record; b record; q record; camp record; step record;
  vars jsonb; v_link text; v_enroll uuid;
  app_url text := 'https://bluladderbid.lovable.app';
  v_old_status public.lead_lifecycle_status;
  v_cancelled integer := 0;
  v_started integer := 0;
  v_step_started integer := 0;
  v_campaigns jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO cust FROM public.customers WHERE id = p_customer_id;
  IF cust.id IS NULL THEN RETURN; END IF;

  v_old_status := cust.lifecycle_status;

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
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

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

    v_campaigns := v_campaigns || jsonb_build_object('id', camp.id, 'name', camp.name);

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
        v_started := v_started + 1;
      ELSIF step.channel = 'email' AND cust.email IS NOT NULL THEN
        INSERT INTO public.sms_messages(
          to_email, channel, subject, body, message_kind, status, customer_id,
          campaign_id, campaign_step_id, enrollment_id, send_at)
        VALUES (
          cust.email, 'email', public.render_msg_template(step.subject, vars),
          public.render_msg_template(step.body_template, vars),
          'lifecycle', 'pending', p_customer_id, camp.id, step.id, v_enroll,
          now() + (step.delay_hours * interval '1 hour'));
        v_started := v_started + 1;
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO public.campaign_audit_log(
    customer_id, actor_id, source, event_type, old_status, new_status,
    campaigns_enrolled, messages_cancelled, messages_started, details)
  VALUES (
    p_customer_id, auth.uid(), p_source, 'status_change', v_old_status, p_status,
    v_campaigns, v_cancelled, v_started,
    jsonb_build_object(
      'customer_name', NULLIF(trim(COALESCE(cust.first_name,'') || ' ' || COALESCE(cust.last_name,'')),''),
      'customer_email', cust.email,
      'customer_phone', cust.phone
    ));
END$function$;