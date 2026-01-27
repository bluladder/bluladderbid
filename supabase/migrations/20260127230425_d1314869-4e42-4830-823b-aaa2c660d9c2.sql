-- Add mutex lock fields to autosync_config for single-concurrency control
ALTER TABLE public.autosync_config 
ADD COLUMN IF NOT EXISTS lock_holder_id TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS lock_acquired_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_run_status TEXT DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS last_run_error TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS total_blocks_synced INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS earliest_coverage_date DATE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS latest_coverage_date DATE DEFAULT NULL;

-- Create function to acquire sync lock (mutex)
CREATE OR REPLACE FUNCTION public.acquire_autosync_lock(p_holder_id TEXT, p_lock_ttl_minutes INTEGER DEFAULT 30)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_current_holder TEXT;
  v_lock_time TIMESTAMPTZ;
BEGIN
  -- Get current lock state
  SELECT lock_holder_id, lock_acquired_at INTO v_current_holder, v_lock_time
  FROM autosync_config WHERE id = 'default' FOR UPDATE;
  
  -- Check if lock is available or expired (TTL exceeded)
  IF v_current_holder IS NULL 
     OR v_lock_time IS NULL 
     OR v_lock_time < (NOW() - (p_lock_ttl_minutes * INTERVAL '1 minute')) THEN
    -- Acquire lock
    UPDATE autosync_config 
    SET lock_holder_id = p_holder_id,
        lock_acquired_at = NOW(),
        last_run_status = 'running',
        updated_at = NOW()
    WHERE id = 'default';
    RETURN TRUE;
  END IF;
  
  -- Lock is held by another process
  RETURN FALSE;
END;
$$;

-- Create function to release sync lock
CREATE OR REPLACE FUNCTION public.release_autosync_lock(p_holder_id TEXT, p_status TEXT DEFAULT 'completed', p_error TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE autosync_config 
  SET lock_holder_id = NULL,
      lock_acquired_at = NULL,
      last_run_status = p_status,
      last_run_error = p_error,
      updated_at = NOW()
  WHERE id = 'default' AND lock_holder_id = p_holder_id;
  
  RETURN FOUND;
END;
$$;

-- Create function to update coverage stats
CREATE OR REPLACE FUNCTION public.update_autosync_coverage()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_total INTEGER;
  v_earliest DATE;
  v_latest DATE;
BEGIN
  SELECT COUNT(*), MIN(start_at::DATE), MAX(end_at::DATE)
  INTO v_total, v_earliest, v_latest
  FROM jobber_busy_blocks
  WHERE status IN ('scheduled', 'in_progress');
  
  UPDATE autosync_config
  SET total_blocks_synced = COALESCE(v_total, 0),
      earliest_coverage_date = v_earliest,
      latest_coverage_date = v_latest,
      updated_at = NOW()
  WHERE id = 'default';
END;
$$;