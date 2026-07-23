
-- Phase 6B.2 adjustment: add `verified_not_created` failure class.
-- Semantics: booking creator verified NO external write happened. The customer
-- is invited to pick fresh availability, and the hold is released so the slot
-- returns to the pool immediately.

-- 1) Extend CHECK constraint.
ALTER TABLE public.sms_booking_confirmations
  DROP CONSTRAINT IF EXISTS sms_booking_confirmations_failure_class_check;

ALTER TABLE public.sms_booking_confirmations
  ADD CONSTRAINT sms_booking_confirmations_failure_class_check
  CHECK (failure_class IS NULL OR failure_class IN (
    'pre_claim_drift',
    'input_missing',
    'reservation_not_live',
    'verified_terminal_rejection',
    'verified_not_created',
    'external_outcome_unknown',
    'external_committed_pending_local',
    'manual_review_required',
    'legacy_unclassified'
  ));

-- 2) Recoverable-failure RPC: accept the new class AND release the hold for it.
DROP FUNCTION IF EXISTS public.mark_sms_booking_recoverable_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT);

CREATE OR REPLACE FUNCTION public.mark_sms_booking_recoverable_failure(
  p_confirmation_id UUID,
  p_execution_token UUID,
  p_failure_class TEXT,
  p_error_code TEXT,
  p_last_error TEXT,
  p_provider_request JSONB,
  p_provider_response JSONB,
  p_reconciliation_status TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
BEGIN
  IF p_failure_class NOT IN (
    'pre_claim_drift',
    'input_missing',
    'reservation_not_live',
    'verified_not_created',
    'external_outcome_unknown',
    'external_committed_pending_local',
    'manual_review_required'
  ) THEN
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
     SET status = 'failed_recoverable',
         failure_class = p_failure_class,
         error_code = COALESCE(p_error_code, error_code),
         last_error = COALESCE(p_last_error, last_error),
         last_error_at = now(),
         provider_request = COALESCE(p_provider_request, provider_request),
         provider_response = COALESCE(p_provider_response, provider_response),
         reconciliation_status = COALESCE(p_reconciliation_status, reconciliation_status, 'pending')
   WHERE id = p_confirmation_id;

  -- verified_not_created: booking creator confirmed nothing was written
  -- externally. Release the appointment hold so the customer can select
  -- fresh availability. All other recoverable classes preserve the hold.
  IF p_failure_class = 'verified_not_created' AND v_row.presentation_id IS NOT NULL THEN
    UPDATE public.sms_availability_presentations
       SET hold_status = 'released',
           hold_released_at = now(),
           hold_release_reason = COALESCE(p_error_code, 'verified_not_created')
     WHERE id = v_row.presentation_id
       AND hold_status = 'held';
  END IF;

  RETURN jsonb_build_object('ok', true, 'failure_class', p_failure_class);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sms_booking_recoverable_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_booking_recoverable_failure(UUID,UUID,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT) TO service_role;

-- 3) claim_sms_booking_execution: customer may retry `verified_not_created`;
--    reconciliation does NOT own this class (customer picks fresh availability).
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

  IF v_row.failure_class = 'manual_review_required' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'manual_review_required',
      'failure_class', v_row.failure_class,
      'reconciliation_status', v_row.reconciliation_status
    );
  END IF;

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

  IF v_source = 'reconciliation' AND v_row.status = 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'customer_owned', 'status', v_row.status);
  END IF;

  IF v_source = 'customer' AND v_row.status IN ('failed','failed_recoverable')
     AND v_row.failure_class IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reconciliation_only', 'failure_class', 'legacy_unclassified');
  END IF;

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
      -- pre_claim_drift / input_missing / reservation_not_live /
      -- verified_not_created / NULL → customer may retry.
    ELSE -- reconciliation
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
