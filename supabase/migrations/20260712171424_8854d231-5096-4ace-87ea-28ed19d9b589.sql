
-- Needed for exclusion constraint mixing equality (text) with range overlap
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1) Authoritative freshness marker: set ONLY when a full sweep completes cleanly
ALTER TABLE public.autosync_config
  ADD COLUMN IF NOT EXISTS last_full_sync_completed_at timestamptz;

-- 2) Slot reservation table (temporary holds + idempotency)
CREATE TABLE IF NOT EXISTS public.slot_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL,
  crew_id text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  session_id text,
  idempotency_key text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','confirmed','released','expired')),
  booking_id uuid,
  jobber_job_id text,
  jobber_visit_id text,
  result_json jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '8 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_reservations TO authenticated;
GRANT ALL ON public.slot_reservations TO service_role;

ALTER TABLE public.slot_reservations ENABLE ROW LEVEL SECURITY;

-- Only admins may touch reservations directly; the booking flow uses SECURITY DEFINER RPCs / service role.
CREATE POLICY "Admins can manage slot reservations"
  ON public.slot_reservations
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE INDEX IF NOT EXISTS idx_slot_reservations_group ON public.slot_reservations(group_id);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_crew_time ON public.slot_reservations(crew_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_slot_reservations_active
  ON public.slot_reservations(crew_id, start_at) WHERE status IN ('held','confirmed');
CREATE INDEX IF NOT EXISTS idx_slot_reservations_idem ON public.slot_reservations(idempotency_key);

-- Prevent two ACTIVE reservations for the same crew from overlapping in time.
ALTER TABLE public.slot_reservations
  DROP CONSTRAINT IF EXISTS slot_reservations_no_overlap;
ALTER TABLE public.slot_reservations
  ADD CONSTRAINT slot_reservations_no_overlap
  EXCLUDE USING gist (
    crew_id WITH =,
    tstzrange(start_at, end_at) WITH &&
  ) WHERE (status IN ('held','confirmed'));

CREATE TRIGGER update_slot_reservations_updated_at
  BEFORE UPDATE ON public.slot_reservations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) RPC: expire stale held reservations
CREATE OR REPLACE FUNCTION public.expire_stale_reservations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.slot_reservations
    SET status = 'expired', updated_at = now()
    WHERE status = 'held' AND expires_at < now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END$$;

-- 4) RPC: atomically hold a slot for one or more crew members
CREATE OR REPLACE FUNCTION public.reserve_booking_slot(
  p_crew_ids text[],
  p_start timestamptz,
  p_end timestamptz,
  p_session text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_ttl_minutes integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_expires timestamptz := now() + make_interval(mins => GREATEST(1, p_ttl_minutes));
  v_crew text;
  v_existing record;
BEGIN
  -- Retire expired holds first so they never block new reservations.
  UPDATE public.slot_reservations
    SET status = 'expired', updated_at = now()
    WHERE status = 'held' AND expires_at < now();

  -- Idempotent replay: if we've seen this key, return the prior outcome.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT group_id, status, result_json
      INTO v_existing
      FROM public.slot_reservations
      WHERE idempotency_key = p_idempotency_key
      ORDER BY created_at DESC
      LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'group_id', v_existing.group_id,
        'status', v_existing.status,
        'result', v_existing.result_json
      );
    END IF;
  END IF;

  BEGIN
    FOREACH v_crew IN ARRAY p_crew_ids LOOP
      INSERT INTO public.slot_reservations(
        group_id, crew_id, start_at, end_at, session_id,
        idempotency_key, status, expires_at)
      VALUES (
        v_group, v_crew, p_start, p_end, p_session,
        p_idempotency_key, 'held', v_expires);
    END LOOP;
  EXCEPTION
    WHEN exclusion_violation THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'conflict');
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'group_id', v_group,
    'status', 'held',
    'expires_at', v_expires
  );
END$$;

-- 5) RPC: record the Jobber job id against a reservation group (for idempotent retries)
CREATE OR REPLACE FUNCTION public.set_reservation_job(
  p_group_id uuid,
  p_job_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.slot_reservations
    SET jobber_job_id = p_job_id, updated_at = now()
    WHERE group_id = p_group_id;
END$$;

-- 6) RPC: confirm a reservation group once the Jobber visit exists
CREATE OR REPLACE FUNCTION public.confirm_booking_slot(
  p_group_id uuid,
  p_booking_id uuid,
  p_job_id text,
  p_visit_id text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.slot_reservations
    SET status = 'confirmed',
        booking_id = p_booking_id,
        jobber_job_id = COALESCE(p_job_id, jobber_job_id),
        jobber_visit_id = p_visit_id,
        result_json = p_result,
        expires_at = now() + interval '30 minutes',
        updated_at = now()
    WHERE group_id = p_group_id;
END$$;

-- 7) RPC: release a held reservation group (booking failed / abandoned)
CREATE OR REPLACE FUNCTION public.release_booking_slot(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.slot_reservations
    SET status = 'released', updated_at = now()
    WHERE group_id = p_group_id AND status = 'held';
END$$;

-- Reservation RPCs are internal booking machinery: keep them off the public API surface.
REVOKE ALL ON FUNCTION public.expire_stale_reservations() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_booking_slot(text[], timestamptz, timestamptz, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_reservation_job(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_booking_slot(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_booking_slot(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.expire_stale_reservations() TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_booking_slot(text[], timestamptz, timestamptz, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_reservation_job(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_booking_slot(uuid, uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_booking_slot(uuid) TO service_role;
