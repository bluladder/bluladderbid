
ALTER TABLE public.callrail_inbound_events
  ADD COLUMN IF NOT EXISTS replay_requested_by UUID,
  ADD COLUMN IF NOT EXISTS replay_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replay_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claim_token UUID,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- Allow the check to accept the transient 'processing' state (already in
-- the original CHECK constraint) — no-op re-assertion for safety.

CREATE OR REPLACE FUNCTION public.claim_due_callrail_retries(_limit INT)
RETURNS TABLE(id UUID) AS $$
DECLARE
  _token UUID := gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.callrail_inbound_events e
    WHERE e.status = 'retry_pending'
      AND (e.next_attempt_at IS NULL OR e.next_attempt_at <= now())
    ORDER BY e.next_attempt_at NULLS FIRST, e.received_at
    LIMIT GREATEST(_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.callrail_inbound_events e
  SET status = 'processing',
      claim_token = _token,
      claimed_at = now()
  FROM candidates c
  WHERE e.id = c.id
  RETURNING e.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_due_callrail_retries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_callrail_retries(INT) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_callrail_event_for_replay(_id UUID, _actor UUID)
RETURNS TABLE(id UUID, provider_message_id TEXT, prior_status TEXT) AS $$
DECLARE
  _row public.callrail_inbound_events%ROWTYPE;
  _token UUID := gen_random_uuid();
BEGIN
  SELECT * INTO _row FROM public.callrail_inbound_events WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF _row.status = 'processing' THEN
    -- Already being worked; caller should back off.
    RETURN QUERY SELECT _row.id, _row.provider_message_id, _row.status;
    RETURN;
  END IF;
  UPDATE public.callrail_inbound_events e
  SET status = 'processing',
      claim_token = _token,
      claimed_at = now(),
      replay_requested_by = _actor,
      replay_requested_at = now(),
      replay_count = COALESCE(e.replay_count, 0) + 1,
      last_error_category = NULL,
      last_error_detail = NULL,
      next_attempt_at = NULL
  WHERE e.id = _id;
  RETURN QUERY SELECT _row.id, _row.provider_message_id, _row.status;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.claim_callrail_event_for_replay(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_callrail_event_for_replay(UUID, UUID) TO service_role;
