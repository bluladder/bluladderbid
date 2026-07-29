#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root_dir/supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql"
fixture="$root_dir/supabase/tests/stage7b/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b/verify_core.sql"
expected_hash=b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca

actual_hash=$(sha256sum "$migration" | cut -d' ' -f1)
test "$actual_hash" = "$expected_hash"

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# The exact artifact is demonstrably idempotent at the schema/data layer.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$migration"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# Existing DFW first-wave access remains visible through the additive
# restrictive policy for the seeded administrator.
dfw_visible=$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.customers;
SQL
)
test "$(printf '%s\n' "$dfw_visible" | tail -1)" = "16"

# Prove the independent grant blocker: the policy claims to permit membership
# administration, but authenticated has no INSERT privilege.
test "$(psql "$STAGE7B_DATABASE_URL" -X -Atc \
  "SELECT has_table_privilege('authenticated','public.organization_memberships','INSERT')")" = "f"

# Prove the independently identified RLS recursion blocker. The expected error
# is evidence for NO-GO; accepting the query would fail this rehearsal.
rls_log=$(mktemp)
if psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL' >"$rls_log" 2>&1
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.organization_memberships;
SQL
then
  echo "expected organization_memberships RLS recursion was not observed" >&2
  exit 1
fi
grep -q "infinite recursion detected in policy" "$rls_log"

# Inject a failure immediately before COMMIT in a fresh database and prove the
# migration's internal transaction leaves no Stage 7B objects behind.
rollback_db=stage7b_rollback_rehearsal
admin_url=${STAGE7B_DATABASE_URL%/*}/postgres
psql "$admin_url" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $rollback_db"
rollback_url=${STAGE7B_DATABASE_URL%/*}/$rollback_db
psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$fixture"
failed_payload=$(mktemp)
sed 's/^COMMIT;$/SELECT 1\\/0;\\nCOMMIT;/' "$migration" >"$failed_payload"
if psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$failed_payload"; then
  echo "injected migration failure unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'")" = "0"

echo "Stage 7B PostgreSQL rehearsal: 30 rows backfilled, one DFW admin, zero Oregon, four FKs, idempotent rerun, atomic injected rollback, RLS recursion blocker proven."
