#!/usr/bin/env bash
set -euo pipefail

: "${VOICE_RETENTION_LOVABLE_DATABASE_URL:?Set VOICE_RETENTION_LOVABLE_DATABASE_URL to a disposable PostgreSQL database}"
: "${VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL:?Set VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL to a second disposable PostgreSQL database}"

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
canonical="$repo_root/supabase/migrations/20260802043233_voice_artifact_retention_purge.sql"
artifact="$repo_root/supabase/release-candidates/20260802043233_voice_artifact_retention_purge_lovable.sql"

bootstrap() {
  local database_url=$1
  psql "$database_url" --set=ON_ERROR_STOP=1 <<'SQL'
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

CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[] NOT NULL DEFAULT ARRAY[]::text[],
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);

CREATE SCHEMA tenant_security;
CREATE TABLE tenant_security.release_provenance (
  release_id text PRIMARY KEY,
  release_commit text NOT NULL,
  source_sha256 text NOT NULL,
  correction_sha256 text NOT NULL,
  artifact_sha256 text NOT NULL,
  project_ref text NOT NULL,
  environment text NOT NULL,
  operator_identity text NOT NULL,
  approval_record text NOT NULL,
  execution_mechanism text NOT NULL,
  execution_started_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transaction_outcome text NOT NULL
    CHECK (transaction_outcome = 'committed'),
  CHECK (release_commit ~ '^[0-9a-f]{40}$'),
  CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (correction_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (btrim(operator_identity) <> ''),
  CHECK (btrim(approval_record) <> '')
);
ALTER TABLE tenant_security.release_provenance OWNER TO postgres;
REVOKE ALL ON tenant_security.release_provenance
  FROM PUBLIC, anon, authenticated, service_role;
CREATE FUNCTION tenant_security.reject_release_provenance_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'release provenance is append-only';
END
$function$;
REVOKE ALL ON FUNCTION tenant_security.reject_release_provenance_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER release_provenance_append_only
  BEFORE UPDATE OR DELETE ON tenant_security.release_provenance
  FOR EACH ROW
  EXECUTE FUNCTION tenant_security.reject_release_provenance_mutation();

CREATE SCHEMA cron;
CREATE TABLE cron.job_store (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text NOT NULL UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
CREATE VIEW cron.job AS
SELECT
  jobid,
  jobname,
  schedule,
  command,
  current_database()::text AS database,
  current_user::text AS username,
  active
FROM cron.job_store;
CREATE FUNCTION cron.schedule(p_job_name text, p_schedule text, p_command text)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO cron.job_store (jobname, schedule, command)
  VALUES (p_job_name, p_schedule, p_command)
  ON CONFLICT (jobname) DO UPDATE
    SET schedule = EXCLUDED.schedule,
        command = EXCLUDED.command,
        active = true
  RETURNING jobid INTO v_id;
  RETURN v_id;
END
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
SQL
}

assert_release_state() {
  local database_url=$1
  local expected_canonical_rows=$2
  psql "$database_url" --set=ON_ERROR_STOP=1 \
    --set=expected_canonical_rows="$expected_canonical_rows" <<'SQL'
SELECT set_config(
  'bluladder.expected_canonical_rows',
  :'expected_canonical_rows',
  false
);
DO $assertion$
BEGIN
  IF (SELECT count(*) FROM tenant_security.release_provenance
      WHERE release_id = 'voice-artifact-retention-lovable-v1'
        AND release_commit = '27bad0cd0e5053cfb436752bee0976c5e1278fd8'
        AND source_sha256 = 'a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102'
        AND correction_sha256 = 'e019c2a1d50fbc1eb539906ed3c9c1754bf06af1d814419da6e6bccf51a9e9ac'
        AND artifact_sha256 = '65836de375d970baa6354ab648c74124d22b39dd1f8b8b93a7ad5800e019cc62'
        AND transaction_outcome = 'committed') <> 1 THEN
    RAISE EXCEPTION 'exact atomic provenance was not recorded';
  END IF;
  IF (to_regclass('private.voice_artifact_purge_runs') IS NOT NULL)::integer
      + (to_regprocedure('private.try_parse_voice_retention_deadline(text)') IS NOT NULL)::integer
      + (to_regprocedure('private.purge_expired_voice_artifact_batch(integer,uuid)') IS NOT NULL)::integer
      + (to_regclass('public.chat_messages_voice_retention_due_idx') IS NOT NULL)::integer <> 4 THEN
    RAISE EXCEPTION 'complete retention object set is unavailable';
  END IF;
  IF (SELECT count(*) FROM cron.job
      WHERE jobname = 'bluladder-voice-artifact-retention-purge'
        AND active
        AND schedule = '7,17,27,37,47,57 * * * *'
        AND command = 'SELECT private.purge_expired_voice_artifact_batch(500, NULL);') <> 1 THEN
    RAISE EXCEPTION 'exact scheduler definition is unavailable';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20260802043233') <>
        current_setting('bluladder.expected_canonical_rows')::integer THEN
    RAISE EXCEPTION 'canonical ledger mode differs';
  END IF;
END
$assertion$;
SQL
}

bootstrap "$VOICE_RETENTION_LOVABLE_DATABASE_URL"
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
SELECT
  '20250000' || to_char(value, 'FM000000'),
  ARRAY['-- synthetic hosted baseline'],
  'synthetic_' || value::text
FROM generate_series(1, 149) AS value;
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES
  ('20260128005316', ARRAY['-- hosted-only history marker'], 'hosted_only'),
  ('20260801234014', ARRAY['-- hosted baseline tip'], 'hosted_tip');
SQL

# The immutable production artifact pins the real hosted-ledger fingerprint.
# Rehearsal uses an otherwise byte-identical transport with only that one
# environment-specific fingerprint replaced by the disposable fixture value.
fixture_fingerprint=$(psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" \
  --set=ON_ERROR_STOP=1 --tuples-only --no-align <<'SQL'
SELECT encode(
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
FROM supabase_migrations.schema_migrations;
SQL
)
production_artifact=$(mktemp)
trap 'rm -f "$production_artifact"' EXIT
sed \
  "s/3366d93be81fb4d5056a93d91a2474df380b3707124568b2c6fc5f1a19f70d0d/$fixture_fingerprint/" \
  "$artifact" >"$production_artifact"

# Inject a failure after the complete canonical body and provenance insert but
# before COMMIT. The explicit envelope must leave no partial object, job, or
# provenance row.
set +e
{
  sed '$d' "$production_artifact"
  printf '%s\n' \
    'DO $forced_failure$' \
    'BEGIN' \
    "  RAISE EXCEPTION 'synthetic pre-commit failure';" \
    'END' \
    '$forced_failure$;' \
    'COMMIT;'
} | psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 >/dev/null 2>&1
partial_status=$?
set -e
if [[ $partial_status -eq 0 ]]; then
  echo 'synthetic pre-commit failure unexpectedly committed' >&2
  exit 1
fi
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DO $rolled_back$
BEGIN
  IF to_regclass('private.voice_artifact_purge_runs') IS NOT NULL
    OR to_regprocedure('private.try_parse_voice_retention_deadline(text)') IS NOT NULL
    OR to_regprocedure('private.purge_expired_voice_artifact_batch(integer,uuid)') IS NOT NULL
    OR to_regclass('public.chat_messages_voice_retention_due_idx') IS NOT NULL
    OR EXISTS (SELECT 1 FROM cron.job
      WHERE jobname = 'bluladder-voice-artifact-retention-purge')
    OR EXISTS (SELECT 1 FROM tenant_security.release_provenance
      WHERE release_id = 'voice-artifact-retention-lovable-v1') THEN
    RAISE EXCEPTION 'partial release state survived transaction rollback';
  END IF;
END
$rolled_back$;
SQL

# Hosted history plus the canonical source version is an explicit conflict.
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20260802043233', ARRAY['-- synthetic conflict'], 'voice_artifact_retention_purge');
SQL
if psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$production_artifact" >/dev/null 2>&1; then
  echo 'hosted canonical-version conflict was not rejected' >&2
  exit 1
fi
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260802043233';
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE private.voice_artifact_purge_runs (synthetic integer);
SQL
if psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$production_artifact" >/dev/null 2>&1; then
  echo 'partial target object was not rejected' >&2
  exit 1
fi
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DROP TABLE private.voice_artifact_purge_runs;
DROP SCHEMA private;
INSERT INTO cron.job_store (jobname, schedule, command)
VALUES (
  'synthetic-uppercase-duplicate',
  '* * * * *',
  'SELECT PRIVATE.PURGE_EXPIRED_VOICE_ARTIFACT_BATCH(500,NULL);'
);
SQL
if psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$production_artifact" >/dev/null 2>&1; then
  echo 'case-variant duplicate purge command was not rejected' >&2
  exit 1
fi
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
DELETE FROM cron.job_store
WHERE jobname = 'synthetic-uppercase-duplicate';
SQL

psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$production_artifact"
assert_release_state "$VOICE_RETENTION_LOVABLE_DATABASE_URL" 0

# Rehearse Lovable's proven one-terminal-LF storage normalization and execute
# the dynamic postflight without ever projecting the stored statement.
artifact_payload_base64=$(head -c -1 "$artifact" | base64 | tr -d '\n')
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --set=artifact_payload_base64="$artifact_payload_base64" \
  --set=fixture_fingerprint="$fixture_fingerprint" <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (
  version,
  statements,
  name
) VALUES (
  '20260802130000',
  ARRAY[
    convert_from(decode(:'artifact_payload_base64', 'base64'), 'UTF8')
  ],
  'synthetic_lovable_execution'
);
DO $ledger_identity$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 152
    OR (SELECT encode(
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
    ) FROM supabase_migrations.schema_migrations
      WHERE version <= '20260801234014') <> :'fixture_fingerprint'
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version > '20260801234014') <> 1
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20260802043233') <> 0
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version = '20260802130000'
        AND cardinality(statements) = 1
        AND octet_length(statements[1]) = 27670
        AND encode(
          extensions.digest(convert_to(statements[1], 'UTF8'), 'sha256'),
          'hex'
        ) = '7c55e5f1389c6003a81dc6951629f9db2fed5416afe4e18c1f2081eda8d92530') <> 1 THEN
    RAISE EXCEPTION 'normalized Lovable ledger payload differs';
  END IF;
END
$ledger_identity$;
SQL
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$repo_root/supabase/verification/voice_artifact_retention_lovable_postflight.sql" \
  >/dev/null

# An unrelated later row with altered SQL must be visible as a second new row
# while the approved payload remains unique. The evidence validator rejects
# that combination; this rehearsal proves the catalog measurements cannot hide
# it.
psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20260802130001', ARRAY['-- altered unrelated payload'], 'unexpected_extra');
DO $extra_row$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE version > '20260801234014') <> 2
    OR (SELECT count(*) FROM supabase_migrations.schema_migrations
      WHERE cardinality(statements) = 1
        AND octet_length(statements[1]) = 27670
        AND encode(
          extensions.digest(convert_to(statements[1], 'UTF8'), 'sha256'),
          'hex'
        ) = '7c55e5f1389c6003a81dc6951629f9db2fed5416afe4e18c1f2081eda8d92530') <> 1 THEN
    RAISE EXCEPTION 'extra or altered ledger row was not measured distinctly';
  END IF;
END
$extra_row$;
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260802130001';
SQL

if psql "$VOICE_RETENTION_LOVABLE_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$production_artifact" >/dev/null 2>&1; then
  echo 'second Lovable artifact execution was not rejected' >&2
  exit 1
fi
assert_release_state "$VOICE_RETENTION_LOVABLE_DATABASE_URL" 0

# A clean rebuild applies the canonical source at its repository version and
# later replays the Lovable-generated artifact. Only this complete mode is
# accepted when the production-only history marker is absent.
bootstrap "$VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL"
psql "$VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL" --set=ON_ERROR_STOP=1 <<'SQL'
INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES ('20260802043233', ARRAY['-- canonical clean rebuild'], 'voice_artifact_retention_purge');
SQL
psql "$VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$canonical"
psql "$VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL" --set=ON_ERROR_STOP=1 \
  --file="$artifact"
assert_release_state "$VOICE_RETENTION_LOVABLE_REBUILD_DATABASE_URL" 1

echo 'Voice retention Lovable PostgreSQL rehearsal passed: production and clean-rebuild modes, conflict gates, atomic rollback, provenance, scheduler, and retry rejection.'
