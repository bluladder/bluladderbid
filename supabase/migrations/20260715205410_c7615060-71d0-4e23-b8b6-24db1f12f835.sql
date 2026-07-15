DO $$
DECLARE
  v_saved uuid;
  v_pending uuid;
  v_booked uuid;
  v_completed uuid;
BEGIN
  -- Saved bid nurture
  IF NOT EXISTS (SELECT 1 FROM public.sms_campaigns WHERE name = 'Saved bid nurture (draft)') THEN
    INSERT INTO public.sms_campaigns (
      name, description, campaign_kind, lifecycle_status, active, status,
      event_name, required_consent, reentry_enabled,
      stop_conditions, audience_conditions, version
    ) VALUES (
      'Saved bid nurture (draft)',
      'Reminds customers about a saved or emailed bid. Stops on booking, reply, takeover, opt-out.',
      'lifecycle', 'quote_saved'::public.lead_lifecycle_status, false, 'draft',
      'quote_saved_or_emailed', 'requested_follow_up', false,
      jsonb_build_object('on_booking','stop','on_reply','stop','on_takeover','stop','on_opt_out','stop'),
      jsonb_build_object('__mode','all'),
      1
    ) RETURNING id INTO v_saved;

    INSERT INTO public.sms_campaign_steps (campaign_id, step_order, channel, delay_hours, subject, body_template, active, is_marketing, business_hours_only) VALUES
      (v_saved, 1, 'sms',   2,   NULL, 'Hi {{first_name}}, your BluLadder bid {{total}} is saved for 30 days: {{link}} Reply STOP to opt out.', false, true, true),
      (v_saved, 2, 'sms',   72,  NULL, 'Hi {{first_name}}, still thinking it over? Your saved bid is right here whenever you''re ready: {{link}} Reply STOP to opt out.', false, true, true),
      (v_saved, 3, 'sms',   336, NULL, 'Hi {{first_name}}, your BluLadder bid expires soon. Lock in {{total}}: {{link}} Reply STOP to opt out.', false, true, true),
      (v_saved, 4, 'sms',   696, NULL, 'Hi {{first_name}}, last chance — your saved bid expires tomorrow: {{link}} Reply STOP to opt out.', false, true, true);
  END IF;

  -- Pending selection recovery
  IF NOT EXISTS (SELECT 1 FROM public.sms_campaigns WHERE name = 'Pending selection recovery (draft)') THEN
    INSERT INTO public.sms_campaigns (
      name, description, campaign_kind, lifecycle_status, active, status,
      event_name, required_consent, reentry_enabled, abandonment_delay_minutes,
      stop_conditions, audience_conditions, version
    ) VALUES (
      'Pending selection recovery (draft)',
      'Re-engages customers who confirmed a selection but didn''t finish booking. Stops on booking, reply, takeover, opt-out.',
      'lifecycle', 'pending'::public.lead_lifecycle_status, false, 'draft',
      'selection_pending', 'requested_follow_up', false, 30,
      jsonb_build_object('on_booking','stop','on_reply','stop','on_takeover','stop','on_opt_out','stop'),
      jsonb_build_object('__mode','all'),
      1
    ) RETURNING id INTO v_pending;

    INSERT INTO public.sms_campaign_steps (campaign_id, step_order, channel, delay_hours, subject, body_template, active, is_marketing, business_hours_only) VALUES
      (v_pending, 1, 'sms', 1,  NULL, 'Hi {{first_name}}, you were almost done booking with BluLadder. Pick up where you left off: {{link}} Reply STOP to opt out.', false, true, true),
      (v_pending, 2, 'sms', 24, NULL, 'Hi {{first_name}}, want us to hold this quote for you? Finish here: {{link}} Reply STOP to opt out.', false, true, true),
      (v_pending, 3, 'sms', 72, NULL, 'Hi {{first_name}}, still interested? Book your BluLadder appointment: {{link}} Reply STOP to opt out.', false, true, true);
  END IF;

  -- Post-booking confirmation (non-marketing)
  IF NOT EXISTS (SELECT 1 FROM public.sms_campaigns WHERE name = 'Post-booking confirmation (draft)') THEN
    INSERT INTO public.sms_campaigns (
      name, description, campaign_kind, lifecycle_status, active, status,
      event_name, required_consent, reentry_enabled,
      stop_conditions, audience_conditions, version
    ) VALUES (
      'Post-booking confirmation (draft)',
      'Operational confirmation after a successful booking. Non-marketing.',
      'lifecycle', 'booked'::public.lead_lifecycle_status, false, 'draft',
      'booking_confirmed', 'transactional', false,
      jsonb_build_object('on_reply','stop','on_takeover','stop','on_opt_out','stop'),
      jsonb_build_object('__mode','all'),
      1
    ) RETURNING id INTO v_booked;

    INSERT INTO public.sms_campaign_steps (campaign_id, step_order, channel, delay_hours, subject, body_template, active, is_marketing, business_hours_only) VALUES
      (v_booked, 1, 'email', 0, 'Your BluLadder appointment is confirmed', 'Hi {{first_name}}, your appointment for {{service}} on {{date}} at {{time}} is confirmed. Details: {{link}}', false, false, false);
  END IF;

  -- Job completed rebook
  IF NOT EXISTS (SELECT 1 FROM public.sms_campaigns WHERE name = 'Job completed rebook (draft)') THEN
    INSERT INTO public.sms_campaigns (
      name, description, campaign_kind, lifecycle_status, active, status,
      event_name, required_consent, reentry_enabled,
      stop_conditions, audience_conditions, version
    ) VALUES (
      'Job completed rebook (draft)',
      'Thank-you, cross-sell and rebook nudges after a completed job. Stops on new booking, reply, takeover, opt-out.',
      'lifecycle', 'completed'::public.lead_lifecycle_status, false, 'draft',
      'job_completed', 'requested_follow_up', false,
      jsonb_build_object('on_booking','stop','on_reply','stop','on_takeover','stop','on_opt_out','stop'),
      jsonb_build_object('__mode','all'),
      1
    ) RETURNING id INTO v_completed;

    INSERT INTO public.sms_campaign_steps (campaign_id, step_order, channel, delay_hours, subject, body_template, active, is_marketing, business_hours_only) VALUES
      (v_completed, 1, 'sms', 24,   NULL, 'Hi {{first_name}}, thanks for choosing BluLadder! We''d love a quick review: {{link}} Reply STOP to opt out.', false, false, true),
      (v_completed, 2, 'sms', 720,  NULL, 'Hi {{first_name}}, ready to add another service? See what''s available: {{link}} Reply STOP to opt out.', false, true,  true),
      (v_completed, 3, 'sms', 7200, NULL, 'Hi {{first_name}}, it''s been about 10 months — time to schedule your next BluLadder visit? {{link}} Reply STOP to opt out.', false, true,  true);
  END IF;
END $$;
