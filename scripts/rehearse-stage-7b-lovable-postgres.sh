#!/bin/sh
set -eu

: "${STAGE7B_DATABASE_URL:?STAGE7B_DATABASE_URL is required}"

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact="$root_dir/supabase/release-candidates/20260730061000_tenant_foundation_stage_7b_lovable.sql"
fixture="$root_dir/supabase/tests/stage7b/hosted_preconditions.sql"
verification="$root_dir/supabase/tests/stage7b/verify_core.sql"
security_verification="$root_dir/supabase/tests/stage7b/verify_security.sql"
canonical_hash=8bb4c57a031831740397339c8023c2da3521473d984de976b5c98836e26b1f9e
file_hash=9fe8054a768c2f92ed4f3c9ddbd95eaf0b8d60868cacca1b293f3d84ec4f18e3
release_id=tenant-foundation-stage-7b-lovable-v1

test "$(sha256sum "$artifact" | cut -d' ' -f1)" = "$file_hash"
test "$(grep -c '^BEGIN;$' "$artifact")" = 1
test "$(grep -c '^COMMIT;$' "$artifact")" = 1
if grep -Eq ":'[a-z_][a-z0-9_]*'" "$artifact"; then
  echo "Lovable artifact contains psql substitutions" >&2
  exit 1
fi

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$fixture"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$artifact"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$verification"
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -f "$security_verification"

# Exact rerun is a no-op for durable identity and revalidates every invariant.
psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$artifact"
test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT (SELECT count(*) FROM public.customers) + (SELECT count(*) FROM public.properties) + (SELECT count(*) FROM public.quotes) + (SELECT count(*) FROM public.bookings)")" = "30"
test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM public.organizations WHERE slug='oregon' AND status='active'")" = "0"

test "$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -c "SELECT count(*) FROM tenant_security.release_provenance WHERE release_id='$release_id' AND release_commit='e8000543d015dec7b6ab16110e4798f596398681' AND artifact_sha256='$canonical_hash' AND project_ref='gyndziiuizpgwhqwyrvn' AND environment='Live/production' AND operator_identity='benjamin-millen' AND execution_mechanism='lovable_cloud_approval' AND transaction_outcome='committed'")" = "1"
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

dfw_visible=$(psql "$STAGE7B_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.customers;
SQL
)
test "$(printf '%s\n' "$dfw_visible" | tail -1)" = 16

psql "$STAGE7B_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v admin_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa <<'SQL'
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'admin_id', false);
SELECT count(*) FROM public.organization_memberships;
SQL

admin_url=${STAGE7B_DATABASE_URL%/*}/postgres
wrong_project_db=stage7b_lovable_wrong_project
rollback_db=stage7b_lovable_rollback
cleanup() {
  psql "$admin_url" -X -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $wrong_project_db WITH (FORCE)" >/dev/null
  psql "$admin_url" -X -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $rollback_db WITH (FORCE)" >/dev/null
}
trap cleanup EXIT INT TERM
cleanup

psql "$admin_url" -X -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE $wrong_project_db"
wrong_project_url=${STAGE7B_DATABASE_URL%/*}/$wrong_project_db
psql "$wrong_project_url" -X -v ON_ERROR_STOP=1 -f "$fixture"
wrong_project_payload=$(mktemp)
sed \
  "s/v_target_project_ref constant text := 'gyndziiuizpgwhqwyrvn'/v_target_project_ref constant text := 'wrong-project'/" \
  "$artifact" >"$wrong_project_payload"
if psql "$wrong_project_url" -X -v ON_ERROR_STOP=1 \
  -f "$wrong_project_payload"; then
  echo "wrong-project artifact unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$wrong_project_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'")" = 0

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
' "$artifact" >"$failed_payload"
if psql "$rollback_url" -X -v ON_ERROR_STOP=1 -f "$failed_payload"; then
  echo "injected pre-commit failure unexpectedly succeeded" >&2
  exit 1
fi
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name='organizations'")" = 0
test "$(psql "$rollback_url" -X -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='tenant_security' AND table_name='release_provenance'")" = 0

echo "Stage 7B Lovable PostgreSQL 17.6 rehearsal passed: exact 24,334-byte SQL, 30-row DFW backfill, hostile RLS, private append-only provenance, wrong-project rejection, idempotent rerun, injected pre-commit rollback, zero active Oregon."
