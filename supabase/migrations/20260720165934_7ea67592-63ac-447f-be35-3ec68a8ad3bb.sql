
CREATE TABLE public.rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

GRANT ALL ON public.rate_limit_buckets TO service_role;

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages rate limit buckets"
  ON public.rate_limit_buckets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_rate_limit_buckets_window_start
  ON public.rate_limit_buckets (window_start);

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  _key TEXT,
  _limit INTEGER,
  _window_ms INTEGER
)
RETURNS TABLE (allowed BOOLEAN, current_count INTEGER, reset_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count INTEGER;
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN
    RAISE EXCEPTION 'rate limit key required';
  END IF;
  IF _limit <= 0 OR _window_ms <= 0 THEN
    RAISE EXCEPTION 'invalid rate limit parameters';
  END IF;

  -- Snap to a fixed window aligned to the epoch so all callers converge on the
  -- same bucket regardless of instance clock skew.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) * 1000 / _window_ms) * _window_ms / 1000.0
  );

  INSERT INTO public.rate_limit_buckets AS b (bucket_key, window_start, window_ms, count)
  VALUES (_key, v_window_start, _window_ms, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET count = b.count + 1, updated_at = now()
  RETURNING count INTO v_count;

  -- Opportunistic cleanup of old windows for this key (bounded, no full scan).
  DELETE FROM public.rate_limit_buckets
  WHERE bucket_key = _key AND window_start < v_window_start;

  RETURN QUERY SELECT
    (v_count <= _limit) AS allowed,
    v_count AS current_count,
    (v_window_start + (_window_ms || ' milliseconds')::interval) AS reset_at;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT, INTEGER, INTEGER) TO anon, authenticated, service_role;
