CREATE OR REPLACE FUNCTION public.claim_due_sms(p_limit integer DEFAULT 50)
RETURNS SETOF public.sms_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Recover messages stuck in 'processing' (e.g. the worker crashed mid-send).
  UPDATE public.sms_messages
    SET status = 'pending', updated_at = now()
    WHERE status = 'processing' AND updated_at < now() - interval '10 minutes';

  -- Atomically claim due, pending messages so concurrent runs never overlap.
  RETURN QUERY
  UPDATE public.sms_messages m
    SET status = 'processing', updated_at = now()
    WHERE m.id IN (
      SELECT id FROM public.sms_messages
        WHERE status = 'pending' AND send_at <= now()
        ORDER BY send_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING m.*;
END$$;

REVOKE ALL ON FUNCTION public.claim_due_sms(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_sms(integer) TO service_role;