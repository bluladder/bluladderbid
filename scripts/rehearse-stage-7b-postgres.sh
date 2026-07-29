#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root_dir/supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql"
fixture="$root_dir/supabase/tests/stage7b/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b/verify_core.sql"
security_verification="$root_dir/supabase/tests/stage7b/verify_security.sql"
expected_hash=b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca
expected_candidate_hash=8c472bfdaeb0c3952f1d31c300673c365a770f628f646fb4c1133c2bf22ff9a3

actual_hash=$(sha256sum "$migration" | cut -d' ' -f1)
test "$actual_hash" = "$expected_hash"
candidate=$(mktemp)
node "$root_dir/scripts/assemble-stage-7b-release-candidate.mjs" "$candidate"
actual_candidate_hash=$(sha256sum "$candidate" | cut -d' ' -f1)
test "$actual_candidate_hash" = "$expected_candidate_hash"

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$candidate"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# The assembled release candidate is safe to repeat as one transaction. The
# vulnerable original payload is never committed independently.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$candidate"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$security_verification"

# Existing DFW first-wave access remains visible through corrected RLS.
dfw_visible=$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.customers;
SQL
)
test "$(printf '%s\n' "$dfw_visible" | tail -1)" = "16"

# Prove authenticated membership access completes without recursion.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.organization_memberships;
SQL

# Inject a failure immediately before COMMIT in a fresh database and prove the
# assembled candidate's single transaction leaves no Stage 7B objects behind.
rollback_db=stage7b_rollback_rehearsal
admin_url=${STAGE7B_DATABASE_URL%/*}/postgres
psql "$admin_url" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $rollback_db"
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
' "$candidate" >"$failed_payload"
if psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$failed_payload"; then
  echo "injected migration failure unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'")" = "0"

echo "Stage 7B corrected PostgreSQL rehearsal: 30 rows backfilled, one DFW admin, zero Oregon, four FKs, hostile authorization passed, no recursion, safe repeated bundle, atomic injected rollback."
