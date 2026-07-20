
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS cancellation_reason text NULL,
  ADD COLUMN IF NOT EXISTS cancellation_notes text NULL,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid NULL,
  ADD COLUMN IF NOT EXISTS cancellation_lifecycle_version integer NULL,
  ADD COLUMN IF NOT EXISTS slot_released_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS jobber_cancellation_status text NULL;

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_cancellation_notes_len;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_cancellation_notes_len
  CHECK (cancellation_notes IS NULL OR char_length(cancellation_notes) <= 500);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_cancellation_reason_len;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_cancellation_reason_len
  CHECK (cancellation_reason IS NULL OR char_length(cancellation_reason) <= 120);

COMMENT ON COLUMN public.bookings.cancellation_reason IS 'Structured reason category for the cancellation (customer-chosen or admin-supplied).';
COMMENT ON COLUMN public.bookings.cancellation_notes IS 'Optional free-form note captured at cancellation time. Never shown publicly.';
COMMENT ON COLUMN public.bookings.cancelled_by IS 'Auth user id (customer or admin) that initiated the confirmed cancellation.';
COMMENT ON COLUMN public.bookings.cancellation_lifecycle_version IS 'Snapshot of booking_version at cancellation confirmation for idempotency scoping.';
COMMENT ON COLUMN public.bookings.slot_released_at IS 'Timestamp the local schedule mirror + slot reservation were released.';
COMMENT ON COLUMN public.bookings.jobber_cancellation_status IS 'Interpreted Jobber outcome: confirmed | already_gone.';

DO $$
DECLARE
  v_cancel uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sms_campaigns WHERE name = 'Appointment Cancellation Confirmation (draft)') THEN
    INSERT INTO public.sms_campaigns (
      name, description, campaign_kind, lifecycle_status, active, status,
      event_name, required_consent, reentry_enabled,
      stop_conditions, audience_conditions, version
    ) VALUES (
      'Appointment Cancellation Confirmation (draft)',
      'Transactional confirmation after a booking cancellation is verified with Jobber. Never sent when cancellation could not be verified.',
      'event', NULL, false, 'draft',
      'booking_cancelled', 'transactional', false,
      jsonb_build_object('on_reply','stop','on_takeover','stop','on_opt_out','stop'),
      jsonb_build_object('__mode','all'),
      1
    ) RETURNING id INTO v_cancel;

    INSERT INTO public.sms_campaign_steps (campaign_id, step_order, channel, delay_hours, subject, body_template, active, is_marketing, business_hours_only) VALUES
      (v_cancel, 1, 'sms', 0, NULL,
        'Hi {{first_name}}, your BluLadder appointment {{previous_appointment_when}} has been cancelled. {{cancellation_feedback_line}} Ready when you are: {{booking_link}}',
        false, false, false),
      (v_cancel, 2, 'email', 0,
        'Your BluLadder appointment has been cancelled',
        'Hi {{first_name}},<br/><br/>We''ve cancelled your BluLadder appointment {{previous_appointment_when}} for {{service_names}} at {{service_address_short}}. {{cancellation_feedback_line}}<br/><br/>Whenever you''re ready, you can book a new time here: <a href="{{booking_link}}">{{booking_link}}</a><br/><br/>— The BluLadder team',
        false, false, false);
  END IF;
END $$;
