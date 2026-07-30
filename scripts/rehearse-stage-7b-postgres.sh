#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
migration="$root_dir/supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql"
fixture="$root_dir/supabase/tests/stage7b/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b/verify_core.sql"
security_verification="$root_dir/supabase/tests/stage7b/verify_security.sql"
provenance="$root_dir/supabase/release-candidates/20260729031000_tenant_foundation_stage_7b_provenance.sql"
expected_hash=b26d38b6b63d5f1fa67f0e7ae8ce0a31eb8892690c9078063fa19dc36ba9c2ca
expected_provenance_hash=bd8cb82c61f47dd6d22fed6c25043c3a5e34e8abd7d5a0e51cde5ff04ee8081f
expected_candidate_hash=1c1da7314771172e7ab07eb826e6ba54d00b01ae3e2e20db9a3798b0456fdb59
fixture_started_at=2026-07-29T20:02:00Z

actual_hash=$(sha256sum "$migration" | cut -d' ' -f1)
test "$actual_hash" = "$expected_hash"
actual_provenance_hash=$(sha256sum "$provenance" | cut -d' ' -f1)
test "$actual_provenance_hash" = "$expected_provenance_hash"
candidate=$(mktemp)
node "$root_dir/scripts/assemble-stage-7b-release-candidate.mjs" "$candidate"
actual_candidate_hash=$(sha256sum "$candidate" | cut -d' ' -f1)
test "$actual_candidate_hash" = "$expected_candidate_hash"

run_candidate() {
  database_url=$1
  project_ref=${2:-gyndziiuizpgwhqwyrvn}
  psql "$database_url" -X -v ON_ERROR_STOP=1 \
    -v candidate_sha256="$expected_candidate_hash" \
    -v provenance_sha256="$expected_provenance_hash" \
    -v operator_identity=disposable-operator \
    -v approval_record=disposable-approval \
    -v project_ref="$project_ref" \
    -v environment=production \
    -v execution_started_at="$fixture_started_at" \
    -f "$candidate"
}

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
run_candidate "$STAGE7B_DATABASE_URL"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"

# The assembled release candidate is safe to repeat as one transaction. The
# vulnerable original payload is never committed independently.
run_candidate "$STAGE7B_DATABASE_URL"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$security_verification"

# The provenance row is atomic, exact, private, append-only, and idempotent only
# for the same immutable evidence.
test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM tenant_security.release_provenance WHERE release_id='tenant-foundation-stage-7b-corrected-v1' AND candidate_sha256='$expected_candidate_hash' AND provenance_sha256='$expected_provenance_hash' AND project_ref='gyndziiuizpgwhqwyrvn' AND environment='production' AND transaction_outcome='committed'")" = "1"
test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT (NOT has_schema_privilege('anon','tenant_security','USAGE') AND NOT has_schema_privilege('service_role','tenant_security','USAGE') AND NOT has_table_privilege('authenticated','tenant_security.release_provenance','SELECT'))::int")" = "1"
if psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "UPDATE tenant_security.release_provenance SET approval_record='mutated'"; then
  echo "append-only provenance update unexpectedly succeeded" >&2
  exit 1
fi
if psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "DELETE FROM tenant_security.release_provenance"; then
  echo "append-only provenance delete unexpectedly succeeded" >&2
  exit 1
fi
if run_candidate "$STAGE7B_DATABASE_URL" wrong-project; then
  echo "wrong-project candidate unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM tenant_security.release_provenance")" = "1"

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
if psql "$rollback_url" -X -v ON_ERROR_STOP=1 \
  -v candidate_sha256="$expected_candidate_hash" \
  -v provenance_sha256="$expected_provenance_hash" \
  -v operator_identity=disposable-operator \
  -v approval_record=disposable-approval \
  -v project_ref=gyndziiuizpgwhqwyrvn \
  -v environment=production \
  -v execution_started_at="$fixture_started_at" \
  -f "$failed_payload"; then
  echo "injected migration failure unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'")" = "0"
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='tenant_security' AND table_name='release_provenance'")" = "0"

echo "Stage 7B corrected PostgreSQL rehearsal: 30 rows backfilled, one DFW admin, zero Oregon, four FKs, hostile authorization passed, private append-only provenance passed, safe exact rerun, wrong-project rejection, atomic injected rollback."
