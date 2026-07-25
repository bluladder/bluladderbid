-- reconcile_sms_booking_matched — finalize a ledger row whose Jobber job was
-- discovered via out-of-band search by the reconciliation runner. Unlike
-- commit_sms_booking_success this does NOT require a local bookings.id and
-- does NOT accept a presentation_id from the caller (uses the row's own).
CREATE OR REPLACE FUNCTION public.reconcile_sms_booking_matched(
  p_confirmation_id UUID,
  p_execution_token UUID,
  p_jobber_job_id TEXT,
  p_jobber_visit_id TEXT,
  p_reference_number TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
  v_pres public.sms_availability_presentations;
BEGIN
  IF p_confirmation_id IS NULL OR p_execution_token IS NULL OR p_jobber_job_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT * INTO v_row FROM public.sms_booking_confirmations
   WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ledger_missing');
  END IF;

  -- Idempotent replay: already reconciled to this Jobber job.
  IF v_row.status IN ('local_committed','confirmation_pending','confirmed')
     AND v_row.jobber_job_id IS NOT DISTINCT FROM p_jobber_job_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'status', v_row.status,
      'jobber_job_id', v_row.jobber_job_id,
      'jobber_visit_id', v_row.jobber_visit_id,
      'reference_number', v_row.reference_number
    );
  END IF;

  IF v_row.status <> 'executing' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_executing', 'status', v_row.status);
  END IF;

  IF v_row.execution_token IS DISTINCT FROM p_execution_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_mismatch');
  END IF;

  -- Consume the presentation hold using the row's own presentation_id.
  IF v_row.presentation_id IS NOT NULL THEN
    SELECT * INTO v_pres FROM public.sms_availability_presentations
     WHERE id = v_row.presentation_id FOR UPDATE;
    IF FOUND THEN
      UPDATE public.sms_availability_presentations
         SET status = 'consumed',
             hold_status = 'consumed',
             hold_released_at = COALESCE(hold_released_at, now()),
             hold_release_reason = 'consumed_by_reconciliation'
       WHERE id = v_pres.id;
    END IF;
  END IF;

  -- Advance the underlying reservation from 'executing' to 'confirmed' so
  -- the expiration sweep leaves it alone and it continues to block capacity.
  IF v_row.slot_group_id IS NOT NULL THEN
    UPDATE public.slot_reservations
       SET status = 'confirmed',
           updated_at = now()
     WHERE group_id = v_row.slot_group_id
       AND status IN ('executing','held');
  END IF;

  UPDATE public.sms_booking_confirmations
     SET status = 'local_committed',
         jobber_job_id = p_jobber_job_id,
         jobber_visit_id = p_jobber_visit_id,
         reference_number = p_reference_number,
         booking_result = jsonb_build_object('reconciled', true, 'source', 'jobber_search'),
         provider_response = jsonb_build_object('reconciled', true, 'source', 'jobber_search'),
         booked_at = COALESCE(booked_at, now()),
         local_committed_at = now(),
         reconciliation_status = 'resolved_matched',
         reconciled_at = now(),
         failure_class = NULL,
         error_code = NULL,
         last_error = NULL
   WHERE id = p_confirmation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'local_committed',
    'jobber_job_id', p_jobber_job_id,
    'jobber_visit_id', p_jobber_visit_id,
    'reference_number', p_reference_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_sms_booking_matched(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_sms_booking_matched(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;