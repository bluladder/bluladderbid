-- Deterministic Lovable Cloud control envelope template.
--
-- This file is not executable as-is. The repository assembler replaces the
-- four named tokens, embeds the canonical migration byte-for-byte, and pins
-- the resulting artifact in the release manifest. Never submit this template.

BEGIN;

DO $release_preconditions$
DECLARE
  v_hosted_history boolean;
  v_canonical_ledgered boolean;
  v_ledger_rows integer;
  v_ledger_tip text;
  v_ledger_fingerprint text;
  v_retention_objects integer;
  v_exact_jobs integer;
  v_purge_command_jobs integer;
BEGIN
  IF to_regclass('tenant_security.release_provenance') IS NULL THEN
    RAISE EXCEPTION 'release provenance authority is unavailable';
  END IF;
  IF to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'SHA-256 digest authority is unavailable';
  END IF;
  IF (
    SELECT encode(
      extensions.digest(
        convert_to(
          string_agg(
            column_name || ':' || data_type || ':' || is_nullable,
            ',' ORDER BY ordinal_position
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    FROM information_schema.columns
    WHERE table_schema = 'tenant_security'
      AND table_name = 'release_provenance'
  ) IS DISTINCT FROM
    '481ec4ee951f8a34d208b6b272b3ba90668e203b5af54b0552a70643652a3bee'
  THEN
    RAISE EXCEPTION 'release provenance schema differs from reviewed authority';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_trigger
    WHERE tgrelid = 'tenant_security.release_provenance'::regclass
      AND tgname = 'release_provenance_append_only'
      AND tgenabled = 'O'
      AND NOT tgisinternal
      AND tgtype = 27
      AND tgfoid =
        'tenant_security.reject_release_provenance_mutation()'::regprocedure
  ) <> 1 THEN
    RAISE EXCEPTION 'release provenance append-only trigger is unavailable';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'tenant_security.release_provenance'::regclass
      AND contype = 'p'
      AND conkey = ARRAY[(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'tenant_security.release_provenance'::regclass
          AND attname = 'release_id'
      )]::smallint[]
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'tenant_security.release_provenance'::regclass
      AND contype = 'c'
  ) <> 7 OR (
    SELECT count(*)
    FROM pg_attrdef
    WHERE adrelid = 'tenant_security.release_provenance'::regclass
  ) <> 1 OR (
    SELECT encode(
      extensions.digest(
        convert_to(
          string_agg(
            contype::text || ':' || pg_get_constraintdef(oid, false),
            E'\x1d' ORDER BY contype::text, pg_get_constraintdef(oid, false)
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    FROM pg_constraint
    WHERE conrelid = 'tenant_security.release_provenance'::regclass
  ) IS DISTINCT FROM
    '0555ec64c8ccc069cd3b92be1f3db590e205d57aff2a9edfc80597bb5a23d624'
    OR (
      SELECT encode(
        extensions.digest(
          convert_to(
            string_agg(
              a.attname || ':' || pg_get_expr(d.adbin, d.adrelid),
              E'\x1d' ORDER BY a.attname
            ),
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )
      FROM pg_attrdef AS d
      INNER JOIN pg_attribute AS a
        ON a.attrelid = d.adrelid
        AND a.attnum = d.adnum
      WHERE d.adrelid = 'tenant_security.release_provenance'::regclass
    ) IS DISTINCT FROM
      'd05dbc654e817158e6b580193c126c5b5555a5202fa4bc9be6e40384bc011e0f'
  THEN
    RAISE EXCEPTION 'release provenance constraints or defaults differ';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE oid =
      'tenant_security.reject_release_provenance_mutation()'::regprocedure
      AND pg_get_userbyid(proowner) = 'postgres'
      AND NOT prosecdef
      AND proconfig = ARRAY['search_path=pg_catalog']::text[]
      AND btrim(regexp_replace(prosrc, '\s+', ' ', 'g')) =
        'BEGIN RAISE EXCEPTION ''release provenance is append-only''; END'
  ) OR has_function_privilege(
    'anon',
    'tenant_security.reject_release_provenance_mutation()',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'tenant_security.reject_release_provenance_mutation()',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'tenant_security.reject_release_provenance_mutation()',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'release provenance rejection function differs';
  END IF;
  IF (
    SELECT pg_get_userbyid(relowner) <> 'postgres'
    FROM pg_class
    WHERE oid = 'tenant_security.release_provenance'::regclass
  ) OR has_table_privilege(
    'anon',
    'tenant_security.release_provenance',
    'SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'authenticated',
    'tenant_security.release_provenance',
    'SELECT,INSERT,UPDATE,DELETE'
  ) OR has_table_privilege(
    'service_role',
    'tenant_security.release_provenance',
    'SELECT,INSERT,UPDATE,DELETE'
  ) THEN
    RAISE EXCEPTION 'release provenance ownership or ACL differs';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM tenant_security.release_provenance
    WHERE release_id = 'voice-artifact-retention-lovable-v1'
  ) THEN
    RAISE EXCEPTION 'voice retention release provenance already exists';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260128005316'
  ) INTO v_hosted_history;

  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version = '20260802043233'
  ) INTO v_canonical_ledgered;

  SELECT
    count(*)::integer,
    max(version),
    encode(
      extensions.digest(
        convert_to(
          string_agg(
            version || E'\x1f' || COALESCE(name, '<NULL>') || E'\x1f' ||
              cardinality(statements)::text || E'\x1f' ||
              encode(
                extensions.digest(
                  convert_to(
                    COALESCE(array_to_string(statements, E'\x1e'), ''),
                    'UTF8'
                  ),
                  'sha256'
                ),
                'hex'
              ),
            E'\x1d' ORDER BY version
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  INTO v_ledger_rows, v_ledger_tip, v_ledger_fingerprint
  FROM supabase_migrations.schema_migrations;

  SELECT count(*)
  INTO v_retention_objects
  FROM (
    SELECT to_regclass('private.voice_artifact_purge_runs') IS NOT NULL
    UNION ALL
    SELECT to_regprocedure(
      'private.try_parse_voice_retention_deadline(text)'
    ) IS NOT NULL
    UNION ALL
    SELECT to_regprocedure(
      'private.purge_expired_voice_artifact_batch(integer,uuid)'
    ) IS NOT NULL
    UNION ALL
    SELECT to_regclass(
      'public.chat_messages_voice_retention_due_idx'
    ) IS NOT NULL
  ) AS object_state(present)
  WHERE present;

  SELECT count(*)
  INTO v_exact_jobs
  FROM cron.job
  WHERE jobname = 'bluladder-voice-artifact-retention-purge';

  SELECT count(*)
  INTO v_purge_command_jobs
  FROM cron.job
  WHERE command ~* 'purge_expired_voice_artifact_batch';

  IF v_hosted_history THEN
    -- Production-history mode. The canonical source version must not already
    -- be ledgered, and no partial target object may predate this transaction.
    IF v_canonical_ledgered THEN
      RAISE EXCEPTION 'canonical source is unexpectedly ledgered in hosted history';
    END IF;
    IF v_ledger_rows <> 151
      OR v_ledger_tip IS DISTINCT FROM '20260801234014'
      OR v_ledger_fingerprint IS DISTINCT FROM
        '3366d93be81fb4d5056a93d91a2474df380b3707124568b2c6fc5f1a19f70d0d'
    THEN
      RAISE EXCEPTION 'hosted migration baseline changed after preflight';
    END IF;
    IF to_regnamespace('private') IS NOT NULL THEN
      RAISE EXCEPTION 'private schema unexpectedly predates retention release';
    END IF;
    IF v_retention_objects <> 0 OR v_exact_jobs <> 0 OR v_purge_command_jobs <> 0 THEN
      RAISE EXCEPTION 'partial voice retention state exists before release';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE confrelid = 'public.chat_messages'::regclass
    ) OR EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgrelid = 'public.chat_messages'::regclass
        AND NOT tgisinternal
        AND (tgtype & 8) = 8
    ) OR EXISTS (
      SELECT 1
      FROM pg_rewrite
      WHERE ev_class = 'public.chat_messages'::regclass
        AND ev_type = '4'
    ) THEN
      RAISE EXCEPTION 'chat message deletion has unreviewed side effects';
    END IF;
  ELSE
    -- Clean-rebuild mode. A local reset applies the canonical source first,
    -- then the later Lovable-generated execution migration. Reapplying the
    -- idempotent canonical body is allowed only from that exact complete state.
    IF NOT v_canonical_ledgered THEN
      RAISE EXCEPTION 'neither production history nor clean rebuild is proven';
    END IF;
    IF v_retention_objects <> 4 OR v_exact_jobs <> 1 OR v_purge_command_jobs <> 1 THEN
      RAISE EXCEPTION 'clean rebuild retention state is incomplete';
    END IF;
    IF (
      SELECT pg_get_userbyid(nspowner) <> 'postgres'
      FROM pg_namespace
      WHERE oid = 'private'::regnamespace
    ) OR (
      SELECT count(*)
      FROM pg_class AS c
      INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    ) <> 1 OR (
      SELECT count(*)
      FROM pg_class AS c
      INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND c.relkind = 'i'
    ) <> 1 OR NOT EXISTS (
      SELECT 1
      FROM pg_index AS i
      INNER JOIN pg_class AS c ON c.oid = i.indexrelid
      INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'private'
        AND i.indrelid = 'private.voice_artifact_purge_runs'::regclass
        AND i.indisprimary
    ) OR (
      SELECT count(*)
      FROM pg_proc AS p
      INNER JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'private'
    ) <> 2 OR EXISTS (
      SELECT 1 FROM private.voice_artifact_purge_runs
    ) THEN
      RAISE EXCEPTION 'clean rebuild private state is not pristine';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM cron.job
      WHERE jobname = 'bluladder-voice-artifact-retention-purge'
        AND active
        AND schedule = '7,17,27,37,47,57 * * * *'
        AND command =
          'SELECT private.purge_expired_voice_artifact_batch(500, NULL);'
    ) THEN
      RAISE EXCEPTION 'clean rebuild scheduler definition differs';
    END IF;
    -- The canonical source uses IF NOT EXISTS for these two objects. Recreate
    -- both from the embedded source so a same-named substitute cannot survive
    -- the generated receipt during a clean repository rebuild.
    EXECUTE 'DROP INDEX public.chat_messages_voice_retention_due_idx';
    EXECUTE 'DROP TABLE private.voice_artifact_purge_runs';
  END IF;
END
$release_preconditions$;

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

DO $release_postconditions$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_class AS c
    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_class AS c
    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private'
      AND c.relkind = 'i'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM pg_index AS i
    INNER JOIN pg_class AS c ON c.oid = i.indexrelid
    INNER JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'private'
      AND i.indrelid = 'private.voice_artifact_purge_runs'::regclass
      AND i.indisprimary
  ) OR (
    SELECT count(*)
    FROM pg_proc AS p
    INNER JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'private'
  ) <> 2 THEN
    RAISE EXCEPTION 'private schema contains an unexpected object set';
  END IF;
  IF (
    SELECT pg_get_userbyid(nspowner) <> 'postgres'
    FROM pg_namespace
    WHERE oid = 'private'::regnamespace
  ) OR EXISTS (
    SELECT 1
    FROM pg_policy
    WHERE polrelid = 'private.voice_artifact_purge_runs'::regclass
  ) THEN
    RAISE EXCEPTION 'private schema ownership or policy set differs';
  END IF;
  IF (
    SELECT encode(
      extensions.digest(
        convert_to(
          string_agg(
            column_name || ':' || data_type || ':' || is_nullable,
            ',' ORDER BY ordinal_position
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
    FROM information_schema.columns
    WHERE table_schema = 'private'
      AND table_name = 'voice_artifact_purge_runs'
  ) IS DISTINCT FROM
    'd4fe6305e6933abd8cc9eb8595c6caa5efc3eba854f345c7d40f1f7cab73ea21'
  THEN
    RAISE EXCEPTION 'voice retention metrics schema differs';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = 'private.voice_artifact_purge_runs'::regclass
      AND relrowsecurity
      AND pg_get_userbyid(relowner) = 'postgres'
  ) OR (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'private.voice_artifact_purge_runs'::regclass
      AND contype = 'p'
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'private.voice_artifact_purge_runs'::regclass
      AND contype = 'c'
  ) <> 9 OR (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'private.voice_artifact_purge_runs'::regclass
      AND contype = 'p'
      AND conkey = ARRAY[(
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'private.voice_artifact_purge_runs'::regclass
          AND attname = 'id'
      )]::smallint[]
  ) <> 1 OR (
    SELECT count(*)
    FROM pg_attrdef AS d
    INNER JOIN pg_attribute AS a
      ON a.attrelid = d.adrelid
      AND a.attnum = d.adnum
    WHERE d.adrelid = 'private.voice_artifact_purge_runs'::regclass
      AND a.attname = 'id'
      AND pg_get_expr(d.adbin, d.adrelid) = 'gen_random_uuid()'
  ) <> 1 THEN
    RAISE EXCEPTION 'voice retention metrics protections differ';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE')
    OR has_schema_privilege('authenticated', 'private', 'USAGE')
    OR has_schema_privilege('service_role', 'private', 'USAGE')
    OR has_table_privilege(
      'anon', 'private.voice_artifact_purge_runs', 'SELECT,INSERT,UPDATE,DELETE'
    )
    OR has_table_privilege(
      'authenticated',
      'private.voice_artifact_purge_runs',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    OR has_table_privilege(
      'service_role',
      'private.voice_artifact_purge_runs',
      'SELECT,INSERT,UPDATE,DELETE'
    ) THEN
    RAISE EXCEPTION 'voice retention private ACLs differ';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid =
      'public.chat_messages_voice_retention_due_idx'::regclass
      AND indrelid = 'public.chat_messages'::regclass
      AND indisvalid
      AND indisready
      AND NOT indisunique
      AND indnkeyatts = 3
  ) THEN
    RAISE EXCEPTION 'voice retention partial index differs';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_proc
    WHERE oid IN (
      'private.try_parse_voice_retention_deadline(text)'::regprocedure,
      'private.purge_expired_voice_artifact_batch(integer,uuid)'::regprocedure
    )
      AND pg_get_userbyid(proowner) = 'postgres'
      AND proconfig = ARRAY['search_path=pg_catalog']::text[]
  ) <> 2 OR has_function_privilege(
    'anon', 'private.try_parse_voice_retention_deadline(text)', 'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'private.try_parse_voice_retention_deadline(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'private.try_parse_voice_retention_deadline(text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'anon',
    'private.purge_expired_voice_artifact_batch(integer,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'private.purge_expired_voice_artifact_batch(integer,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'service_role',
    'private.purge_expired_voice_artifact_batch(integer,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'voice retention function authority differs';
  END IF;
  IF (
    SELECT count(*)
    FROM cron.job
    WHERE command ~* 'purge_expired_voice_artifact_batch'
  ) <> 1 OR (
    SELECT count(*)
    FROM cron.job
    WHERE jobname = 'bluladder-voice-artifact-retention-purge'
      AND active
      AND database = current_database()
      AND username = current_user
      AND schedule = '7,17,27,37,47,57 * * * *'
      AND command =
        'SELECT private.purge_expired_voice_artifact_batch(500, NULL);'
  ) <> 1 THEN
    RAISE EXCEPTION 'voice retention scheduler authority differs';
  END IF;
END
$release_postconditions$;

INSERT INTO tenant_security.release_provenance (
  release_id,
  release_commit,
  source_sha256,
  correction_sha256,
  artifact_sha256,
  project_ref,
  environment,
  operator_identity,
  approval_record,
  execution_mechanism,
  execution_started_at,
  transaction_outcome
) VALUES (
  'voice-artifact-retention-lovable-v1',
  '27bad0cd0e5053cfb436752bee0976c5e1278fd8',
  'a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102',
  'e019c2a1d50fbc1eb539906ed3c9c1754bf06af1d814419da6e6bccf51a9e9ac',
  '65836de375d970baa6354ab648c74124d22b39dd1f8b8b93a7ad5800e019cc62',
  'gyndziiuizpgwhqwyrvn',
  'Live/production',
  'benjamin-millen',
  'owner-operated-voice-retention-lovable-v1',
  'lovable_cloud_approval',
  transaction_timestamp(),
  'committed'
);

COMMIT;
