#!/usr/bin/env bash
set -euo pipefail

: "${VOICE_RETENTION_DATABASE_URL:?Set VOICE_RETENTION_DATABASE_URL to a disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
migration="$repo_root/supabase/migrations/20260802043233_voice_artifact_retention_purge.sql"

psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END;
$roles$;

CREATE SCHEMA cron;
CREATE TABLE cron.scheduled_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name text NOT NULL UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL
);
CREATE FUNCTION cron.schedule(p_job_name text, p_schedule text, p_command text)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO cron.scheduled_jobs (job_name, schedule, command)
  VALUES (p_job_name, p_schedule, p_command)
  ON CONFLICT (job_name) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command = EXCLUDED.command
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE TABLE public.chat_conversations (
  id uuid PRIMARY KEY,
  session_token text NOT NULL,
  channel text NOT NULL,
  organization_id uuid
);
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id),
  role text NOT NULL,
  content text,
  tool_name text,
  tool_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ai_metadata jsonb
);

-- Sentinels prove the migration never reaches business or conversation state.
CREATE TABLE public.quote_sessions (id uuid PRIMARY KEY);
CREATE TABLE public.quotes (id uuid PRIMARY KEY);
CREATE TABLE public.customers (id uuid PRIMARY KEY);
CREATE TABLE public.properties (id uuid PRIMARY KEY);
CREATE TABLE public.bookings (id uuid PRIMARY KEY);
INSERT INTO public.quote_sessions VALUES ('90000000-0000-0000-0000-000000000001');
INSERT INTO public.quotes VALUES ('90000000-0000-0000-0000-000000000002');
INSERT INTO public.customers VALUES ('90000000-0000-0000-0000-000000000003');
INSERT INTO public.properties VALUES ('90000000-0000-0000-0000-000000000004');
INSERT INTO public.bookings VALUES ('90000000-0000-0000-0000-000000000005');
SQL

psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 --file="$migration"

psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $schedule$
BEGIN
  IF (SELECT count(*) FROM cron.scheduled_jobs
      WHERE job_name = 'bluladder-voice-artifact-retention-purge'
        AND schedule = '7,17,27,37,47,57 * * * *'
        AND command = 'SELECT private.purge_expired_voice_artifact_batch(500, NULL);') <> 1 THEN
    RAISE EXCEPTION 'scheduler definition did not converge on one exact job';
  END IF;
END;
$schedule$;

INSERT INTO public.chat_conversations (id, session_token, channel, organization_id) VALUES
  ('10000000-0000-0000-0000-000000000001', 'vapi_call:tenant-a', 'voice', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('10000000-0000-0000-0000-000000000002', 'vapi_call:tenant-b', 'voice', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('10000000-0000-0000-0000-000000000003', 'web-session', 'web', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO public.chat_messages (
  id, conversation_id, role, content, tool_name, tool_result, ai_metadata
) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-a1', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '3 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'assistant', 'synthetic-a2', NULL, NULL,
    jsonb_build_object('channel','voice','source','end_of_call','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '2 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-a3', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'user', 'synthetic-b1', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-b','retention_expires_at',to_char(now() - interval '2 days','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', 'assistant', 'synthetic-b2', NULL, NULL,
    jsonb_build_object('channel','voice','source','end_of_call','provider_call_id','vapi_call:tenant-b','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-unexpired', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() + interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000003', 'user', 'synthetic-web-parent', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','web-session','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000001', 'assistant', 'synthetic-nonvoice', NULL, NULL,
    jsonb_build_object('channel','web','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-legacy', NULL, NULL,
    jsonb_build_object('channel','voice','source','legacy','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-malformed', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at','not-a-date')),
  ('20000000-0000-0000-0000-000000000015', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-null', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',NULL)),
  ('20000000-0000-0000-0000-000000000016', '10000000-0000-0000-0000-000000000001', 'user', 'synthetic-provider-mismatch', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:other','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000017', '10000000-0000-0000-0000-000000000001', 'tool', NULL, 'synthetic_tool', '{}'::jsonb,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))),
  ('20000000-0000-0000-0000-000000000018', '10000000-0000-0000-0000-000000000001', 'assistant', '   ', NULL, NULL,
    jsonb_build_object('channel','voice','source','controller','provider_call_id','vapi_call:tenant-a','retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
SQL

# A second session owns the global advisory lock. The purge must fail fast and
# record only aggregate metrics rather than overlapping it.
psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 --quiet <<'SQL' &
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('bluladder:voice-artifact-retention-purge', 0));
SELECT pg_sleep(2);
COMMIT;
SQL
lock_session_pid=$!
sleep 1
psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 --quiet \
  --command="SELECT * FROM private.purge_expired_voice_artifact_batch(1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');" >/dev/null
wait "$lock_session_pid"

psql "$VOICE_RETENTION_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $concurrency$
BEGIN
  IF (SELECT status FROM private.voice_artifact_purge_runs ORDER BY started_at DESC, id DESC LIMIT 1) <> 'skipped_concurrent' THEN
    RAISE EXCEPTION 'concurrent execution did not fail fast';
  END IF;
END;
$concurrency$;

SELECT * FROM private.purge_expired_voice_artifact_batch(2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

DO $first_batch$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE id IN (
    '20000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000002'
  )) THEN
    RAISE EXCEPTION 'expired eligible rows deleted assertion failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'batch boundary failed';
  END IF;
  IF (SELECT rows_examined FROM private.voice_artifact_purge_runs ORDER BY started_at DESC, id DESC LIMIT 1) <> 2 THEN
    RAISE EXCEPTION 'batch examined metric failed';
  END IF;
  IF (SELECT count(*) FROM public.chat_messages WHERE conversation_id = '10000000-0000-0000-0000-000000000002') <> 2 THEN
    RAISE EXCEPTION 'cross-tenant isolation failed';
  END IF;
END;
$first_batch$;

SELECT * FROM private.purge_expired_voice_artifact_batch(2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SELECT * FROM private.purge_expired_voice_artifact_batch(2, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

DO $preservation$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000003') THEN
    RAISE EXCEPTION 'remaining expired eligible row was not deleted';
  END IF;
  IF (SELECT status FROM private.voice_artifact_purge_runs ORDER BY started_at DESC, id DESC LIMIT 1) <> 'no_candidates' THEN
    RAISE EXCEPTION 'idempotent retry failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000010') THEN
    RAISE EXCEPTION 'unexpired row was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id IN (
    '20000000-0000-0000-0000-000000000011',
    '20000000-0000-0000-0000-000000000012',
    '20000000-0000-0000-0000-000000000013'
  )) THEN
    RAISE EXCEPTION 'unrelated message was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000014') THEN
    RAISE EXCEPTION 'malformed retention marker was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000015') THEN
    RAISE EXCEPTION 'null retention marker was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id IN (
    '20000000-0000-0000-0000-000000000016',
    '20000000-0000-0000-0000-000000000017',
    '20000000-0000-0000-0000-000000000018'
  )) THEN
    RAISE EXCEPTION 'lineage or artifact-shape guard failed';
  END IF;
  IF (SELECT count(*) FROM public.chat_conversations) <> 3
    OR (SELECT count(*) FROM public.quote_sessions) <> 1
    OR (SELECT count(*) FROM public.quotes) <> 1
    OR (SELECT count(*) FROM public.customers) <> 1
    OR (SELECT count(*) FROM public.properties) <> 1
    OR (SELECT count(*) FROM public.bookings) <> 1 THEN
    RAISE EXCEPTION 'non-artifact business state changed';
  END IF;
END;
$preservation$;

INSERT INTO public.chat_messages (
  id, conversation_id, role, content, tool_name, tool_result, ai_metadata
) VALUES (
  '20000000-0000-0000-0000-000000000020',
  '10000000-0000-0000-0000-000000000001',
  'user',
  'synthetic-failure',
  NULL,
  NULL,
  jsonb_build_object(
    'channel','voice',
    'source','controller',
    'provider_call_id','vapi_call:tenant-a',
    'retention_expires_at',to_char(now() - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
);

CREATE FUNCTION public.rehearsal_block_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'synthetic delete failure';
END;
$function$;
CREATE TRIGGER rehearsal_block_delete
  BEFORE DELETE ON public.chat_messages
  FOR EACH STATEMENT EXECUTE FUNCTION public.rehearsal_block_delete();

SELECT * FROM private.purge_expired_voice_artifact_batch(1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

DO $failure$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000020') THEN
    RAISE EXCEPTION 'failure rollback did not preserve the row';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private.voice_artifact_purge_runs
    WHERE status = 'failed'
      AND rows_examined = 1
      AND rows_deleted = 0
      AND rows_failed = 1
      AND error_code = 'P0001'
  ) THEN
    RAISE EXCEPTION 'privacy-safe failure metrics were not recorded';
  END IF;
END;
$failure$;

DROP TRIGGER rehearsal_block_delete ON public.chat_messages;
DROP FUNCTION public.rehearsal_block_delete();
SELECT * FROM private.purge_expired_voice_artifact_batch(1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

DO $retry_after_failure$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE id = '20000000-0000-0000-0000-000000000020') THEN
    RAISE EXCEPTION 'retry after failure did not delete the eligible row';
  END IF;
END;
$retry_after_failure$;

SELECT * FROM private.purge_expired_voice_artifact_batch(500, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DO $final$
BEGIN
  IF EXISTS (SELECT 1 FROM public.chat_messages WHERE id IN (
    '20000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000005'
  )) THEN
    RAISE EXCEPTION 'second tenant eligible rows were not deleted';
  END IF;
  IF EXISTS (
    SELECT 1 FROM private.voice_artifact_purge_runs
    WHERE rows_examined < 0 OR rows_deleted < 0 OR rows_skipped < 0
      OR rows_failed < 0 OR elapsed_ms < 0
  ) THEN
    RAISE EXCEPTION 'invalid aggregate purge metric';
  END IF;
END;
$final$;
SQL

echo "Voice artifact retention PostgreSQL rehearsal passed: strict expiry, tenant scope, batch bounds, concurrency, retries, failure rollback, and non-artifact preservation."
