
-- Extend slot_reservations status to include 'executing'.
ALTER TABLE public.slot_reservations
  DROP CONSTRAINT IF EXISTS slot_reservations_status_check;
ALTER TABLE public.slot_reservations
  ADD CONSTRAINT slot_reservations_status_check
  CHECK (status = ANY (ARRAY['held','executing','confirmed','released','expired']));

-- Extend the no-overlap exclusion so 'executing' reservations also block
-- overlapping holds. This preserves capacity while Jobber is being called.
ALTER TABLE public.slot_reservations
  DROP CONSTRAINT IF EXISTS slot_reservations_no_overlap;
ALTER TABLE public.slot_reservations
  ADD CONSTRAINT slot_reservations_no_overlap
  EXCLUDE USING gist (
    crew_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status = ANY (ARRAY['held','executing','confirmed']));

-- Update active-index predicate to include 'executing'.
DROP INDEX IF EXISTS idx_slot_reservations_active;
CREATE INDEX idx_slot_reservations_active
  ON public.slot_reservations (crew_id, start_at)
  WHERE status = ANY (ARRAY['held','executing','confirmed']);

-- Atomically flip every reservation in a hold group from 'held' -> 'executing'
-- and extend expires_at so the periodic expiration sweep cannot release the
-- appointment while jobber-create-booking is still in flight. Idempotent when
-- the reservation is already 'executing' or already 'confirmed'.
CREATE OR REPLACE FUNCTION public.protect_reservation_for_execution(
  p_group_id uuid,
  p_min_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
  v_total integer;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_group_id');
  END IF;

  SELECT count(*) INTO v_total
    FROM public.slot_reservations
   WHERE group_id = p_group_id;
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_reservations');
  END IF;

  UPDATE public.slot_reservations
     SET status = 'executing',
         expires_at = GREATEST(expires_at, COALESCE(p_min_expires_at, expires_at)),
         updated_at = now()
   WHERE group_id = p_group_id
     AND status IN ('held', 'executing');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', v_updated > 0,
    'updated', v_updated,
    'total', v_total
  );
END;
$$;

-- Move protected reservations back to 'held' (recoverable failure, allow the
-- reconciliation runner to retry) or 'released' (verified not_created —
-- return capacity to the pool). Called by executeSmsBooking on failure paths.
CREATE OR REPLACE FUNCTION public.unprotect_reservation_after_failure(
  p_group_id uuid,
  p_new_status text DEFAULT 'held',
  p_hold_ttl_minutes integer DEFAULT 8
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_group_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_group_id');
  END IF;
  IF p_new_status NOT IN ('held','released') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_target_status');
  END IF;

  UPDATE public.slot_reservations
     SET status = p_new_status,
         expires_at = CASE
           WHEN p_new_status = 'held'
             THEN now() + make_interval(mins => GREATEST(1, p_hold_ttl_minutes))
           ELSE expires_at
         END,
         updated_at = now()
   WHERE group_id = p_group_id
     AND status = 'executing';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('ok', v_updated > 0, 'updated', v_updated, 'new_status', p_new_status);
END;
$$;

-- Lock down execution privileges: only postgres/service_role should call these.
REVOKE ALL ON FUNCTION public.protect_reservation_for_execution(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unprotect_reservation_after_failure(uuid, text, integer) FROM PUBLIC, anon, authenticated;
