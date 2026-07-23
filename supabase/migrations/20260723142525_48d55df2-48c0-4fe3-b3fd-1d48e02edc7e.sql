-- Phase 5 — hold state + atomic activation for sms_availability_presentations.

-- 1) Persist the canonical customer identity that was anchored at presentation
--    time, plus the full slot-hold state. All internal — no client access.
ALTER TABLE public.sms_availability_presentations
  ADD COLUMN IF NOT EXISTS resolved_customer_id UUID,
  ADD COLUMN IF NOT EXISTS identity_resolution_method TEXT,
  ADD COLUMN IF NOT EXISTS hold_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS hold_group_id UUID,
  ADD COLUMN IF NOT EXISTS held_crew_ids TEXT[],
  ADD COLUMN IF NOT EXISTS held_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_end_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_released_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_release_reason TEXT,
  ADD COLUMN IF NOT EXISTS hold_idempotency_key TEXT;

ALTER TABLE public.sms_availability_presentations
  DROP CONSTRAINT IF EXISTS sms_availability_presentations_hold_status_check;
ALTER TABLE public.sms_availability_presentations
  ADD CONSTRAINT sms_availability_presentations_hold_status_check
  CHECK (hold_status IN (
    'none','held','released','expired',
    'revalidation_failed','conflict','superseded'
  ));

-- 2) Database-enforced single active presentation per conversation.
--    Partial unique index means at most one row per conversation may be in
--    status='active' at any point in time. The atomic RPC below sequences
--    supersede -> activate so this rule is never violated in practice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_presentations_one_active_per_convo
  ON public.sms_availability_presentations (conversation_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_sms_presentations_hold_expiring
  ON public.sms_availability_presentations (hold_expires_at)
  WHERE hold_status = 'held';

-- 3) Transactional activation + supersession + prior-hold release.
--    Runs in a single implicit transaction inside the function body:
--      a. Retire the prior active presentation (if any) on this conversation.
--      b. Release any hold the prior active presentation was carrying so its
--         capacity is returned to the pool.
--      c. Flip this pending_send row to active.
--    Returns the activated row id, or NULL if the row was not in
--    pending_send status (idempotent replay path — caller re-reads the row).
CREATE OR REPLACE FUNCTION public.activate_presentation_atomic(
  p_id UUID,
  p_outbound_sms_id UUID,
  p_outbound_message_preview TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_convo UUID;
  v_now   TIMESTAMPTZ := now();
  v_prior RECORD;
BEGIN
  SELECT conversation_id
    INTO v_convo
    FROM public.sms_availability_presentations
    WHERE id = p_id AND status = 'pending_send'
    FOR UPDATE;

  IF v_convo IS NULL THEN
    RETURN NULL;
  END IF;

  -- Retire prior active presentations on the same conversation, releasing any
  -- 8-minute hold they were carrying so that capacity returns to the pool.
  FOR v_prior IN
    SELECT id, hold_group_id, hold_status
      FROM public.sms_availability_presentations
      WHERE conversation_id = v_convo
        AND status = 'active'
        AND id <> p_id
      FOR UPDATE
  LOOP
    IF v_prior.hold_status = 'held' AND v_prior.hold_group_id IS NOT NULL THEN
      PERFORM public.release_booking_slot(v_prior.hold_group_id);
      UPDATE public.sms_availability_presentations
        SET hold_status = 'released',
            hold_released_at = v_now,
            hold_release_reason = 'superseded_by_new_presentation'
        WHERE id = v_prior.id;
    END IF;

    UPDATE public.sms_availability_presentations
      SET status = 'superseded',
          superseded_by = p_id,
          superseded_at = v_now
      WHERE id = v_prior.id;
  END LOOP;

  UPDATE public.sms_availability_presentations
    SET status = 'active',
        activated_at = v_now,
        outbound_sms_id = p_outbound_sms_id,
        outbound_message_preview = p_outbound_message_preview
    WHERE id = p_id;

  RETURN p_id;
END $$;

-- 4) Sweep abandoned 8-minute holds. Any presentation whose hold has passed
--    hold_expires_at is flipped to hold_status='expired' and the underlying
--    slot_reservations group is released so the capacity is offered again.
CREATE OR REPLACE FUNCTION public.expire_stale_presentation_holds()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row   RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, hold_group_id
      FROM public.sms_availability_presentations
      WHERE hold_status = 'held'
        AND hold_expires_at IS NOT NULL
        AND hold_expires_at <= now()
      FOR UPDATE SKIP LOCKED
  LOOP
    IF v_row.hold_group_id IS NOT NULL THEN
      PERFORM public.release_booking_slot(v_row.hold_group_id);
    END IF;
    UPDATE public.sms_availability_presentations
      SET hold_status = 'expired',
          hold_released_at = now(),
          hold_release_reason = 'ttl_expired'
      WHERE id = v_row.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END $$;

-- 5) Lock these to service_role only. No public / anon / authenticated exec.
REVOKE ALL ON FUNCTION public.activate_presentation_atomic(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expire_stale_presentation_holds() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_presentation_atomic(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_presentation_holds() TO service_role;