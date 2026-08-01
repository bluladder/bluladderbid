#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root_dir/supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql"
fixture="$root_dir/supabase/tests/stage7b-v2/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b-v2/verify.sql"
admin_url=${STAGE7B_DATABASE_URL%/*}/postgres

create_fixture_database() {
  database_name=$1
  psql "$admin_url" -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $database_name"
  psql "${STAGE7B_DATABASE_URL%/*}/$database_name" \
    -X -v ON_ERROR_STOP=1 -f "$fixture"
}

assert_rolled_back_to_fixture() {
  database_url=$1
  expected_function_hash=$2
  test "$(psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c \
    "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('quote_sessions','chat_conversations') AND column_name='organization_id'")" = "0"
  test "$(psql "$database_url" -X -At -v ON_ERROR_STOP=1 -c \
    "SELECT md5(pg_get_functiondef('public.enforce_first_wave_organization_lineage()'::regprocedure))")" = "$expected_function_hash"
}

expect_migration_failure() {
  database_url=$1
  label=$2
  if psql "$database_url" -X -v ON_ERROR_STOP=1 -f "$migration"; then
    echo "$label unexpectedly allowed the migration" >&2
    exit 1
  fi
}

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# Exact rerun remains safe and preserves resolved/unresolved lineage.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# The two hosted quote defect classes each stop before any schema change.
null_quote_db=stage7b_v2_null_quote_gate
create_fixture_database "$null_quote_db"
null_quote_url=${STAGE7B_DATABASE_URL%/*}/$null_quote_db
null_quote_hash=$(psql "$null_quote_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT md5(pg_get_functiondef('public.enforce_first_wave_organization_lineage()'::regprocedure))")
psql "$null_quote_url" -X -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public.quotes(id, customer_id, property_id) VALUES ('e0000000-0000-4000-8000-000000000020','c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001')"
expect_migration_failure "$null_quote_url" "null quote ownership stop gate"
assert_rolled_back_to_fixture "$null_quote_url" "$null_quote_hash"

mismatch_quote_db=stage7b_v2_mismatch_quote_gate
create_fixture_database "$mismatch_quote_db"
mismatch_quote_url=${STAGE7B_DATABASE_URL%/*}/$mismatch_quote_db
mismatch_quote_hash=$(psql "$mismatch_quote_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT md5(pg_get_functiondef('public.enforce_first_wave_organization_lineage()'::regprocedure))")
psql "$mismatch_quote_url" -X -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public.quotes(id, organization_id, customer_id, property_id) VALUES ('e0000000-0000-4000-8000-000000000021','b0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000002')"
expect_migration_failure "$mismatch_quote_url" "quote/customer mismatch stop gate"
assert_rolled_back_to_fixture "$mismatch_quote_url" "$mismatch_quote_hash"

# A second-wave conflict is discovered after DDL has begun. The explicit
# transaction must still restore the exact pre-migration fixture.
session_conflict_db=stage7b_v2_session_conflict_gate
create_fixture_database "$session_conflict_db"
session_conflict_url=${STAGE7B_DATABASE_URL%/*}/$session_conflict_db
session_conflict_hash=$(psql "$session_conflict_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT md5(pg_get_functiondef('public.enforce_first_wave_organization_lineage()'::regprocedure))")
psql "$session_conflict_url" -X -v ON_ERROR_STOP=1 -c \
  "INSERT INTO public.quote_sessions(id, channel, customer_id, property_id) VALUES ('f0000000-0000-4000-8000-000000000020','voice','c0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002')"
expect_migration_failure "$session_conflict_url" "second-wave conflict stop gate"
assert_rolled_back_to_fixture "$session_conflict_url" "$session_conflict_hash"

# An injected pre-commit failure must leave no second-wave columns behind.
rollback_db=stage7b_v2_rollback_rehearsal
create_fixture_database "$rollback_db"
rollback_url=${STAGE7B_DATABASE_URL%/*}/$rollback_db
rollback_hash=$(psql "$rollback_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT md5(pg_get_functiondef('public.enforce_first_wave_organization_lineage()'::regprocedure))")
failed_payload=$(mktemp)
trap 'rm -f "$failed_payload"' EXIT
awk '
  /^COMMIT;$/ {
    print "SELECT 1/0;"
    print "COMMIT;"
    next
  }
  { print }
' "$migration" >"$failed_payload"
if psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$failed_payload"; then
  echo "injected Stage 7B v2 failure unexpectedly succeeded" >&2
  exit 1
fi
assert_rolled_back_to_fixture "$rollback_url" "$rollback_hash"

echo "Stage 7B v2 PostgreSQL rehearsal passed: parent-only backfill, old-runtime/new-schema compatibility, both quote stop-gate classes, second-wave conflict rollback, cross-tenant RLS/DML, explicit service-role behavior, grants, invoker views, exact rerun, and atomic rollback."
