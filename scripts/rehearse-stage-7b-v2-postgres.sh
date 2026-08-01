#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root_dir/supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql"
fixture="$root_dir/supabase/tests/stage7b-v2/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b-v2/verify.sql"

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# Exact rerun remains safe and preserves resolved/unresolved lineage.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# An injected pre-commit failure must leave no second-wave columns behind.
rollback_db=stage7b_v2_rollback_rehearsal
admin_url=${STAGE7B_DATABASE_URL%/*}/postgres
psql "$admin_url" -X -v ON_ERROR_STOP=1 -c "CREATE DATABASE $rollback_db"
rollback_url=${STAGE7B_DATABASE_URL%/*}/$rollback_db
psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$fixture"
failed_payload=$(mktemp)
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
test "$(psql "$rollback_url" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('quote_sessions','chat_conversations') AND column_name='organization_id'")" = "0"

echo "Stage 7B v2 PostgreSQL rehearsal passed: parent-only backfill, cross-tenant RLS/DML, explicit grants, invoker views, exact rerun, and atomic rollback."
