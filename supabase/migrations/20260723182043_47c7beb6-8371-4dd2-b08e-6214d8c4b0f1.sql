
-- ============================================================================
-- Phase 6B.1 safety-correction — reconciliation eligibility narrowing +
-- frozen manual-review semantics.
-- ============================================================================

-- 1) claim_sms_booking_execution: narrow reconciliation eligibility and
--    freeze manual_review_required for both sources.
DROP FUNCTION IF EXISTS public.claim_sms_booking_execution(UUID, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.claim_sms_booking_execution(
  p_confirmation_id UUID,
  p_execution_token UUID,
  p_claim_source TEXT DEFAULT 'customer'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
  v_source TEXT := COALESCE(NULLIF(p_claim_source,''), 'customer');
BEGIN
  IF v_source NOT IN ('customer','reconciliation') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_source');
  END IF;

  SELECT * INTO v_row
    FROM public.sms_booking_confirmations
   WHERE id = p_confirmation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Committed / confirmed short-circuit (both sources).
  IF v_row.status IN ('confirmed','local_committed','confirmation_pending','jobber_created') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_completed',
      'status', v_row.status,
      'booking_id', v_row.booking_id,
      'jobber_job_id', v_row.jobber_job_id,
      'jobber_visit_id', v_row.jobber_visit_id,
      'reference_number', v_row.reference_number
    );
  END IF;

  IF v_row.status = 'failed_terminal' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'failed_terminal',
      'failure_class', v_row.failure_class,
      'last_error', v_row.last_error
    );
  END IF;

  -- FREEZE: manual_review_required is never automatically re-claimable,
  -- regardless of ledger status. Only explicit admin resolution moves it.
  IF v_row.failure_class = 'manual_review_required' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'manual_review_required',
      'failure_class', v_row.failure_class,
      'reconciliation_status', v_row.reconciliation_status
    );
  END IF;

  -- Executing lane: same worker resumes, everyone else refused.
  IF v_row.status = 'executing' THEN
    IF v_row.execution_token IS DISTINCT FROM p_execution_token THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'in_progress',
        'execution_token', v_row.execution_token,
        'execution_started_at', v_row.execution_started_at
      );
    END IF;
    RETURN jsonb_build_object('ok', true, 'resumed', true, 'attempt_count', v_row.attempt_count);
  END IF;

  -- Reconciliation may NEVER claim a pending row: it hasn't entered any
  -- reconciliation-owned failure state and belongs to the customer path.
  IF v_source = 'reconciliation' AND v_row.status = 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'customer_owned',
      'status', v_row.status
    );
  END IF;

  -- Legacy null-class rows in any failure state → customer refused;
  -- reconciliation may deliberately pick them up as legacy_unclassified.
  IF v_source = 'customer' AND v_row.status IN ('failed','failed_recoverable')
     AND v_row.failure_class IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'reconciliation_only',
      'failure_class', 'legacy_unclassified'
    );
  END IF;

  -- failed_recoverable branch — enforce classification-based eligibility.
  IF v_row.status = 'failed_recoverable' THEN
    IF v_source = 'customer' THEN
      -- Reconciliation-owned classes are never customer-retryable.
      IF v_row.failure_class IN (
        'external_outcome_unknown',
        'external_committed_pending_local',
        'legacy_unclassified'
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'reconciliation_only',
          'failure_class', v_row.failure_class
        );
      END IF;
      -- pre_claim_drift / input_missing / reservation_not_live / NULL → customer may retry.
    ELSE -- reconciliation
      -- Reconciliation-owned automatic classes only.
      IF v_row.failure_class NOT IN (
        'external_outcome_unknown',
        'external_committed_pending_local',
        'legacy_unclassified'
      ) THEN
        RETURN jsonb_build_object(
          'ok', false,
          'reason', 'customer_owned',
          'failure_class', v_row.failure_class
        );
      END IF;
    END IF;
  END IF;

  IF v_row.status NOT IN ('pending','failed','failed_recoverable') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_state', 'status', v_row.status);
  END IF;

  UPDATE public.sms_booking_confirmations
     SET status = 'executing',
         execution_token = p_execution_token,
         execution_started_at = now(),
         attempt_count = COALESCE(attempt_count, 0) + 1,
         reconciliation_status = CASE
           WHEN v_source = 'reconciliation' THEN 'in_progress'
           ELSE reconciliation_status
         END
   WHERE id = p_confirmation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'attempt_count', COALESCE(v_row.attempt_count,0) + 1,
    'claim_source', v_source,
    'prior_failure_class', v_row.failure_class
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sms_booking_execution(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_booking_execution(UUID, UUID, TEXT) TO service_role;

-- 2) mark_sms_booking_terminal_failure: manual_review_required is NO LONGER
--    a legal terminal class. Escalating to manual review must not release
--    the appointment hold — it goes through the recoverable RPC instead.
DROP FUNCTION IF EXISTS public.mark_sms_booking_terminal_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB);

CREATE OR REPLACE FUNCTION public.mark_sms_booking_terminal_failure(
  p_confirmation_id UUID,
  p_execution_token UUID,
  p_failure_class TEXT,
  p_error_code TEXT,
  p_last_error TEXT,
  p_provider_response JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
BEGIN
  -- Only verified rejections may terminate + release the hold.
  IF p_failure_class IS DISTINCT FROM 'verified_terminal_rejection' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_failure_class', 'failure_class', p_failure_class);
  END IF;

  SELECT * INTO v_row FROM public.sms_booking_confirmations
   WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_row.status IN ('local_committed','confirmation_pending','confirmed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_committed');
  END IF;

  IF v_row.status = 'executing' AND v_row.execution_token IS DISTINCT FROM p_execution_token THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'token_mismatch');
  END IF;

  UPDATE public.sms_booking_confirmations
     SET status = 'failed_terminal',
         failure_class = p_failure_class,
         error_code = COALESCE(p_error_code, error_code),
         last_error = COALESCE(p_last_error, last_error),
         last_error_at = now(),
         provider_response = COALESCE(p_provider_response, provider_response)
   WHERE id = p_confirmation_id;

  IF v_row.presentation_id IS NOT NULL THEN
    UPDATE public.sms_availability_presentations
       SET hold_status = 'released',
           hold_released_at = now(),
           hold_release_reason = COALESCE(p_error_code, 'booking_terminal_failure')
     WHERE id = v_row.presentation_id
       AND hold_status = 'held';
  END IF;

  RETURN jsonb_build_object('ok', true, 'failure_class', p_failure_class);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sms_booking_terminal_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_booking_terminal_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB) TO service_role;
