-- Canonical 30-day voice artifact retention.
--
-- Scope is intentionally narrow: only bounded user/assistant transcript rows
-- written by the canonical controller or end-of-call journal are eligible.
-- The parent conversation supplies tenant authority and is never deleted.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE ALL ON SCHEMA private FROM anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.voice_artifact_purge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  organization_scope uuid,
  batch_size integer NOT NULL CHECK (batch_size BETWEEN 1 AND 500),
  rows_examined integer NOT NULL CHECK (rows_examined >= 0),
  rows_deleted integer NOT NULL CHECK (rows_deleted >= 0),
  rows_skipped integer NOT NULL CHECK (rows_skipped >= 0),
  rows_failed integer NOT NULL CHECK (rows_failed >= 0),
  elapsed_ms bigint NOT NULL CHECK (elapsed_ms >= 0),
  status text NOT NULL CHECK (
    status IN (
      'deleted',
      'no_candidates',
      'completed_with_skips',
      'skipped_concurrent',
      'failed'
    )
  ),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[0-9A-Z]{5}$'),
  CHECK (rows_deleted + rows_skipped + rows_failed <= rows_examined)
);

ALTER TABLE private.voice_artifact_purge_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.voice_artifact_purge_runs
  FROM PUBLIC, anon, authenticated, service_role;

-- JavaScript Date.toISOString() is the sole approved retention marker shape.
-- Invalid, null, offset, truncated, or otherwise malformed values return NULL
-- and therefore fail closed rather than becoming purge candidates.
CREATE OR REPLACE FUNCTION private.try_parse_voice_retention_deadline(
  p_value text
)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_parts text[];
BEGIN
  v_parts := pg_catalog.regexp_match(
    p_value,
    '^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})\.([0-9]{3})Z$'
  );

  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.make_timestamptz(
    v_parts[1]::integer,
    v_parts[2]::integer,
    v_parts[3]::integer,
    v_parts[4]::integer,
    v_parts[5]::integer,
    v_parts[6]::numeric + (v_parts[7]::numeric / 1000),
    'UTC'
  );
EXCEPTION
  WHEN datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.try_parse_voice_retention_deadline(text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Text order is chronological for the exact UTC ISO marker emitted by
-- Date.toISOString(). The strict parser is still applied before deletion.
-- Fail the migration instead of waiting through an unsafe writer lock or an
-- unexpectedly large index build; the release window must investigate first.
SET lock_timeout = '5s';
SET statement_timeout = '2min';
CREATE INDEX IF NOT EXISTS chat_messages_voice_retention_due_idx
  ON public.chat_messages (
    (ai_metadata ->> 'retention_expires_at'),
    conversation_id,
    id
  )
  WHERE role IN ('user', 'assistant')
    AND tool_name IS NULL
    AND tool_result IS NULL
    AND ai_metadata ->> 'channel' = 'voice'
    AND ai_metadata ->> 'source' IN ('controller', 'end_of_call');
RESET statement_timeout;
RESET lock_timeout;

CREATE OR REPLACE FUNCTION private.purge_expired_voice_artifact_batch(
  p_batch_size integer DEFAULT 500,
  p_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  run_id uuid,
  run_status text,
  rows_examined integer,
  rows_deleted integer,
  rows_skipped integer,
  rows_failed integer,
  elapsed_ms bigint
)
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
DECLARE
  v_started_at timestamptz := pg_catalog.clock_timestamp();
  v_finished_at timestamptz;
  v_cutoff timestamptz := v_started_at;
  v_cutoff_iso text;
  v_candidate_ids uuid[] := ARRAY[]::uuid[];
  v_examined integer := 0;
  v_deleted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_elapsed_ms bigint := 0;
  v_status text;
  v_error_code text;
  v_run_id uuid;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 500 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'voice artifact purge batch size must be between 1 and 500';
  END IF;

  v_cutoff_iso := pg_catalog.to_char(
    v_cutoff AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  );

  -- The named pg_cron job is already single-flight. This transaction-scoped
  -- advisory lock also makes manual invocations and scheduler retries safe.
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('bluladder:voice-artifact-retention-purge', 0)
  ) THEN
    v_finished_at := pg_catalog.clock_timestamp();
    v_elapsed_ms := GREATEST(
      0,
      pg_catalog.floor(
        pg_catalog.date_part('epoch', v_finished_at - v_started_at) * 1000
      )::bigint
    );

    INSERT INTO private.voice_artifact_purge_runs (
      started_at,
      finished_at,
      organization_scope,
      batch_size,
      rows_examined,
      rows_deleted,
      rows_skipped,
      rows_failed,
      elapsed_ms,
      status,
      error_code
    ) VALUES (
      v_started_at,
      v_finished_at,
      p_organization_id,
      p_batch_size,
      0,
      0,
      0,
      0,
      v_elapsed_ms,
      'skipped_concurrent',
      NULL
    )
    RETURNING id INTO v_run_id;

    RETURN QUERY SELECT v_run_id, 'skipped_concurrent'::text, 0, 0, 0, 0,
      v_elapsed_ms;
    RETURN;
  END IF;

  -- An exception in candidate locking or deletion rolls this inner block
  -- back atomically. Only a SQLSTATE is retained; message content, customer
  -- data, provider payloads, and exception text are never persisted.
  BEGIN
    SELECT
      COALESCE(
        pg_catalog.array_agg(candidate.id ORDER BY candidate.retention_deadline, candidate.id),
        ARRAY[]::uuid[]
      ),
      pg_catalog.count(*)::integer
    INTO v_candidate_ids, v_examined
    FROM (
      SELECT
        m.id,
        m.ai_metadata ->> 'retention_expires_at' AS retention_deadline
      FROM public.chat_messages AS m
      INNER JOIN public.chat_conversations AS c
        ON c.id = m.conversation_id
      WHERE c.channel = 'voice'
        AND c.organization_id IS NOT NULL
        AND (p_organization_id IS NULL OR c.organization_id = p_organization_id)
        AND m.role IN ('user', 'assistant')
        AND m.content IS NOT NULL
        AND pg_catalog.btrim(m.content) <> ''
        AND m.tool_name IS NULL
        AND m.tool_result IS NULL
        AND m.ai_metadata ->> 'channel' = 'voice'
        AND m.ai_metadata ->> 'source' IN ('controller', 'end_of_call')
        AND m.ai_metadata ->> 'provider_call_id' = c.session_token
        AND m.ai_metadata ->> 'retention_expires_at' <= v_cutoff_iso
        AND private.try_parse_voice_retention_deadline(
          m.ai_metadata ->> 'retention_expires_at'
        ) <= v_cutoff
      ORDER BY m.ai_metadata ->> 'retention_expires_at', m.id
      LIMIT p_batch_size
      FOR UPDATE OF m, c SKIP LOCKED
    ) AS candidate;

    IF v_examined > 0 THEN
      DELETE FROM public.chat_messages AS m
      USING public.chat_conversations AS c
      WHERE m.id = ANY (v_candidate_ids)
        AND c.id = m.conversation_id
        AND c.channel = 'voice'
        AND c.organization_id IS NOT NULL
        AND (p_organization_id IS NULL OR c.organization_id = p_organization_id)
        AND m.role IN ('user', 'assistant')
        AND m.content IS NOT NULL
        AND pg_catalog.btrim(m.content) <> ''
        AND m.tool_name IS NULL
        AND m.tool_result IS NULL
        AND m.ai_metadata ->> 'channel' = 'voice'
        AND m.ai_metadata ->> 'source' IN ('controller', 'end_of_call')
        AND m.ai_metadata ->> 'provider_call_id' = c.session_token
        AND m.ai_metadata ->> 'retention_expires_at' <= v_cutoff_iso
        AND private.try_parse_voice_retention_deadline(
          m.ai_metadata ->> 'retention_expires_at'
        ) <= v_cutoff;

      GET DIAGNOSTICS v_deleted = ROW_COUNT;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE;
      v_failed := v_examined;
      v_deleted := 0;
  END;

  v_skipped := GREATEST(
    v_examined - v_deleted - v_failed,
    0
  );

  v_status := CASE
    WHEN v_error_code IS NOT NULL THEN 'failed'
    WHEN v_examined = 0 THEN 'no_candidates'
    WHEN v_skipped > 0 THEN 'completed_with_skips'
    ELSE 'deleted'
  END;

  v_finished_at := pg_catalog.clock_timestamp();
  v_elapsed_ms := GREATEST(
    0,
    pg_catalog.floor(
      pg_catalog.date_part('epoch', v_finished_at - v_started_at) * 1000
    )::bigint
  );

  INSERT INTO private.voice_artifact_purge_runs (
    started_at,
    finished_at,
    organization_scope,
    batch_size,
    rows_examined,
    rows_deleted,
    rows_skipped,
    rows_failed,
    elapsed_ms,
    status,
    error_code
  ) VALUES (
    v_started_at,
    v_finished_at,
    p_organization_id,
    p_batch_size,
    v_examined,
    v_deleted,
    v_skipped,
    v_failed,
    v_elapsed_ms,
    v_status,
    v_error_code
  )
  RETURNING id INTO v_run_id;

  RETURN QUERY SELECT
    v_run_id,
    v_status,
    v_examined,
    v_deleted,
    v_skipped,
    v_failed,
    v_elapsed_ms;
END;
$function$;

REVOKE ALL ON FUNCTION private.purge_expired_voice_artifact_batch(integer, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Existing pg_cron is the repository scheduler. A named job makes migration
-- reapplication converge on one definition. Each execution deletes at most
-- 500 rows and pg_cron does not overlap two runs of the same named job.
SELECT cron.schedule(
  'bluladder-voice-artifact-retention-purge',
  '7,17,27,37,47,57 * * * *',
  $cron$SELECT private.purge_expired_voice_artifact_batch(500, NULL);$cron$
);
