
-- ============================================================================
-- Phase 6A safety correction: execution state machine + atomic RPCs
-- ============================================================================

-- 1) Extend sms_booking_confirmations with execution-state columns.
ALTER TABLE public.sms_booking_confirmations
  ADD COLUMN IF NOT EXISTS execution_token UUID,
  ADD COLUMN IF NOT EXISTS execution_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_request JSONB,
  ADD COLUMN IF NOT EXISTS provider_response JSONB,
  ADD COLUMN IF NOT EXISTS reconciliation_status TEXT,
  ADD COLUMN IF NOT EXISTS local_committed_at TIMESTAMPTZ;

-- 2) Replace the status CHECK with the full state machine. Keep 'failed' for
--    backward compat but require new writers to use failed_recoverable /
--    failed_terminal.
ALTER TABLE public.sms_booking_confirmations
  DROP CONSTRAINT IF EXISTS sms_booking_confirmations_status_check;
ALTER TABLE public.sms_booking_confirmations
  ADD CONSTRAINT sms_booking_confirmations_status_check
  CHECK (status IN (
    'pending',
    'executing',
    'jobber_created',
    'local_committed',
    'confirmation_pending',
    'confirmed',
    'failed',
    'failed_recoverable',
    'failed_terminal'
  ));

-- 3) Refresh the partial unique index to also cover in-progress + committed
--    states so a duplicate YES for a presentation can never insert a second
--    ledger row.
DROP INDEX IF EXISTS public.uq_smsbc_presentation_active;
CREATE UNIQUE INDEX uq_smsbc_presentation_active
  ON public.sms_booking_confirmations (presentation_id)
  WHERE presentation_id IS NOT NULL
    AND status IN (
      'pending','executing','jobber_created','local_committed',
      'confirmation_pending','confirmed'
    );

-- 4) claim_sms_booking_execution — atomic single-worker execution claim.
CREATE OR REPLACE FUNCTION public.claim_sms_booking_execution(
  p_confirmation_id UUID,
  p_execution_token UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
BEGIN
  -- Lock the target row to serialise concurrent YES processors.
  SELECT * INTO v_row
    FROM public.sms_booking_confirmations
   WHERE id = p_confirmation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Already terminal / committed states short-circuit.
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
    RETURN jsonb_build_object('ok', false, 'reason', 'failed_terminal', 'last_error', v_row.last_error);
  END IF;

  -- Another worker is currently executing.
  IF v_row.status = 'executing' THEN
    IF v_row.execution_token IS DISTINCT FROM p_execution_token THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'in_progress',
        'execution_token', v_row.execution_token,
        'execution_started_at', v_row.execution_started_at
      );
    END IF;
    -- Same worker replaying its own claim — allow.
    RETURN jsonb_build_object('ok', true, 'resumed', true, 'attempt_count', v_row.attempt_count);
  END IF;

  -- pending | failed_recoverable | failed → executing (allowed transitions).
  IF v_row.status NOT IN ('pending','failed_recoverable','failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_state', 'status', v_row.status);
  END IF;

  UPDATE public.sms_booking_confirmations
     SET status = 'executing',
         execution_token = p_execution_token,
         execution_started_at = now(),
         attempt_count = COALESCE(attempt_count, 0) + 1
   WHERE id = p_confirmation_id;

  RETURN jsonb_build_object('ok', true, 'attempt_count', COALESCE(v_row.attempt_count,0) + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_sms_booking_execution(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_sms_booking_execution(UUID, UUID) TO service_role;

-- 5) commit_sms_booking_success — atomic write of external + local IDs and
--    consume the presentation hold in one transaction.
CREATE OR REPLACE FUNCTION public.commit_sms_booking_success(
  p_confirmation_id UUID,
  p_execution_token UUID,
  p_presentation_id UUID,
  p_hold_group_id UUID,
  p_booking_id UUID,
  p_jobber_job_id TEXT,
  p_jobber_visit_id TEXT,
  p_reference_number TEXT,
  p_booking_result JSONB,
  p_provider_response JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.sms_booking_confirmations;
  v_pres public.sms_availability_presentations;
BEGIN
  SELECT * INTO v_row FROM public.sms_booking_confirmations
   WHERE id = p_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ledger_missing');
  END IF;

  -- Idempotent replay: same booking already committed for this row.
  IF v_row.status IN ('local_committed','confirmation_pending','confirmed')
     AND v_row.booking_id IS NOT NULL
     AND (p_booking_id IS NULL OR v_row.booking_id = p_booking_id) THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'status', v_row.status,
      'booking_id', v_row.booking_id,
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

  IF v_row.presentation_id IS DISTINCT FROM p_presentation_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'presentation_mismatch');
  END IF;

  SELECT * INTO v_pres FROM public.sms_availability_presentations
   WHERE id = p_presentation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'presentation_missing');
  END IF;

  IF v_pres.hold_group_id IS DISTINCT FROM p_hold_group_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hold_group_mismatch');
  END IF;

  IF v_pres.hold_status NOT IN ('held','consumed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hold_not_consumable', 'hold_status', v_pres.hold_status);
  END IF;

  UPDATE public.sms_booking_confirmations
     SET status = 'local_committed',
         booking_id = p_booking_id,
         jobber_job_id = p_jobber_job_id,
         jobber_visit_id = p_jobber_visit_id,
         reference_number = p_reference_number,
         booking_result = p_booking_result,
         provider_response = p_provider_response,
         booked_at = COALESCE(booked_at, now()),
         local_committed_at = now(),
         error_code = NULL,
         last_error = NULL
   WHERE id = p_confirmation_id;

  UPDATE public.sms_availability_presentations
     SET status = 'consumed',
         hold_status = 'consumed',
         hold_released_at = COALESCE(hold_released_at, now()),
         hold_release_reason = 'consumed_by_booking'
   WHERE id = p_presentation_id;

  RETURN jsonb_build_object('ok', true, 'status', 'local_committed');
END;
$$;

REVOKE ALL ON FUNCTION public.commit_sms_booking_success(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_sms_booking_success(UUID,UUID,UUID,UUID,UUID,TEXT,TEXT,TEXT,JSONB,JSONB) TO service_role;

-- 6) mark_sms_booking_terminal_failure — atomic terminal-failure path that
--    releases the underlying reservation and stamps ledger + presentation.
CREATE OR REPLACE FUNCTION public.mark_sms_booking_terminal_failure(
  p_confirmation_id UUID,
  p_execution_token UUID,
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
         error_code = COALESCE(p_error_code, error_code),
         last_error = COALESCE(p_last_error, last_error),
         last_error_at = now(),
         provider_response = COALESCE(p_provider_response, provider_response)
   WHERE id = p_confirmation_id;

  -- Release the hold on the presentation.
  IF v_row.presentation_id IS NOT NULL THEN
    UPDATE public.sms_availability_presentations
       SET hold_status = 'released',
           hold_released_at = now(),
           hold_release_reason = COALESCE(p_error_code, 'booking_terminal_failure')
     WHERE id = v_row.presentation_id
       AND hold_status = 'held';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sms_booking_terminal_failure(UUID,UUID,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_booking_terminal_failure(UUID,UUID,TEXT,TEXT,JSONB) TO service_role;

-- 7) mark_sms_booking_recoverable_failure — records a non-terminal failure
--    (timeout, unknown outcome, local commit crash). The hold is INTENTIONALLY
--    preserved so the reconciliation worker can resolve the true outcome.
CREATE OR REPLACE FUNCTION public.mark_sms_booking_recoverable_failure(
  p_confirmation_id UUID,
  p_execution_token UUID,
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
         error_code = COALESCE(p_error_code, error_code),
         last_error = COALESCE(p_last_error, last_error),
         last_error_at = now(),
         provider_request = COALESCE(p_provider_request, provider_request),
         provider_response = COALESCE(p_provider_response, provider_response),
         reconciliation_status = COALESCE(p_reconciliation_status, reconciliation_status)
   WHERE id = p_confirmation_id;

  -- Do NOT release the hold — that is the whole point of this state.
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_sms_booking_recoverable_failure(UUID,UUID,TEXT,TEXT,JSONB,JSONB,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_sms_booking_recoverable_failure(UUID,UUID,TEXT,TEXT,JSONB,JSONB,TEXT) TO service_role;

-- 8) Outbound SMS idempotency key: prevent duplicate confirmation texts.
ALTER TABLE public.sms_messages
  ADD COLUMN IF NOT EXISTS outbound_idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_messages_outbound_idempotency_key
  ON public.sms_messages (outbound_idempotency_key)
  WHERE outbound_idempotency_key IS NOT NULL;
