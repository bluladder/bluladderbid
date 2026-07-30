# Stage 7B corrected direct-execution runbook

Status: **superseded for production; DO NOT EXECUTE**.

Production is Lovable Cloud and does not expose the direct database credentials
or `psql` control path assumed below. This file is retained only to document the
original candidate contract. The authoritative reassessment is
`lovable-cloud-control-plane.md`. Authorization alone does not make this
mechanism supported.

## 1. Required authorization and evidence

Require one approval record naming:

- candidate SHA-256
  `1c1da7314771172e7ab07eb826e6ba54d00b01ae3e2e20db9a3798b0456fdb59`;
- direct `psql` execution and unchanged Supabase migration ledger;
- project `gyndziiuizpgwhqwyrvn`, environment `production`;
- operator, independent reviewer, UTC window, and incident channel;
- separate cron pause/drain and restore authority for jobs 3, 5, and 6.

Use an approved secret-injection mechanism for `DATABASE_URL`. Never echo,
persist, or include it in evidence.

## 2. Freeze, assemble, and verify

From a clean detached checkout containing this package:

```sh
set -eu
NODE=/path/to/node
CANDIDATE=/tmp/stage7b-corrected.sql
EVIDENCE_DIR=/approved/redacted/stage7b-$(date -u +%Y%m%dT%H%M%SZ)
PROJECT_REF=gyndziiuizpgwhqwyrvn
TARGET_ENV=production
OPERATOR_ID='<approved operator identifier>'
REVIEWER_ID='<approved reviewer identifier>'
APPROVAL_RECORD='<approval record identifier>'

mkdir -p "$EVIDENCE_DIR"/{before,execution,after,restore}
"$NODE" scripts/assemble-stage-7b-release-candidate.mjs "$CANDIDATE"
CANDIDATE_SHA=$(sha256sum "$CANDIDATE" | awk '{print $1}')
PROVENANCE_SHA=$(sha256sum \
  supabase/release-candidates/20260729031000_tenant_foundation_stage_7b_provenance.sql \
  | awk '{print $1}')
test "$CANDIDATE_SHA" = \
  1c1da7314771172e7ab07eb826e6ba54d00b01ae3e2e20db9a3798b0456fdb59
test "$PROVENANCE_SHA" = \
  bd8cb82c61f47dd6d22fed6c25043c3a5e34e8abd7d5a0e51cde5ff04ee8081f
test "$(wc -c < "$CANDIDATE" | tr -d ' ')" = 24721
psql --version
```

Stop on any identity, hash, size, checkout, tool-version, authorization, or
evidence-directory mismatch.

Record the clean post-merge checkout commit containing provenance Git blob
`e75945a712289db69421aaedee26e47254a40212` as
`artifact.provenance_commit` in the external evidence JSON. This commit is
intentionally not embedded in `release.json`, because doing so before that
commit exists would create a self-referential repository identity.

```sh
PROVENANCE_COMMIT=$(git rev-parse HEAD)
test -z "$(git status --porcelain)"
test "$(git rev-parse \
  "$PROVENANCE_COMMIT:supabase/release-candidates/20260729031000_tenant_foundation_stage_7b_provenance.sql")" \
  = e75945a712289db69421aaedee26e47254a40212
```

Record `PROVENANCE_COMMIT` and
`artifact.provenance_commit_contains_blob=true` in the evidence JSON.

## 3. Read-only preflight

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v project_ref="$PROJECT_REF" \
  -v environment="$TARGET_ENV" \
  -f supabase/preflight/tenant_stage_7b_corrected_release.sql \
  > "$EVIDENCE_DIR/before/preflight.txt"
sha256sum "$EVIDENCE_DIR/before/preflight.txt" \
  > "$EVIDENCE_DIR/before/preflight.sha256"
```

Require the signed baseline: PostgreSQL 17.6; ledger count 145, tip
`20260726194719`, fingerprint `73ed8522db78e51049a421e1f72b18c3`;
16 customers, 10 properties, 2 quotes, 2 bookings; one platform role; all Stage
7B objects and first-wave columns absent; job fingerprints exactly matching
`release.json`; no active job 3/5/6 run.

Stop if any query fails or differs. Catalog existence without the complete
baseline is not approval.

## 4. Separately authorized cron pause and drain

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  > "$EVIDENCE_DIR/before/cron-pause.txt" <<'SQL'
SELECT cron.alter_job(3, active := false);
SELECT cron.alter_job(5, active := false);
SELECT cron.alter_job(6, active := false);
SELECT jobid, active, md5(command) AS command_fingerprint
FROM cron.job WHERE jobid IN (3,5,6) ORDER BY jobid;
SELECT count(*) AS active_runs
FROM cron.job_run_details
WHERE jobid IN (3,5,6) AND status IN ('starting','running');
SQL
```

Require all three inactive, unchanged fingerprints, and zero active runs. If a
run is active, wait only within the authorized window and recheck; do not kill it
without separate incident authority.

## 5. Exact atomic execution

```sh
EXECUTION_STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
set +e
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v candidate_sha256="$CANDIDATE_SHA" \
  -v provenance_sha256="$PROVENANCE_SHA" \
  -v operator_identity="$OPERATOR_ID" \
  -v approval_record="$APPROVAL_RECORD" \
  -v project_ref="$PROJECT_REF" \
  -v environment="$TARGET_ENV" \
  -v execution_started_at="$EXECUTION_STARTED_AT" \
  -f "$CANDIDATE" \
  > "$EVIDENCE_DIR/execution/psql-redacted.txt" 2>&1
EXECUTION_STATUS=$?
set -e
date -u +%Y-%m-%dT%H:%M:%SZ \
  > "$EVIDENCE_DIR/execution/finished-at.txt"
printf '%s\n' "$EXECUTION_STATUS" \
  > "$EVIDENCE_DIR/execution/exit-status.txt"
sha256sum "$EVIDENCE_DIR/execution/psql-redacted.txt" \
  > "$EVIDENCE_DIR/execution/psql-redacted.sha256"
test "$EXECUTION_STATUS" -eq 0
```

Do not retry an error or ambiguous disconnect. Proceed only to read-only
postflight and incident containment.

## 6. Read-only postflight

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v candidate_sha256="$CANDIDATE_SHA" \
  -v provenance_sha256="$PROVENANCE_SHA" \
  -v project_ref="$PROJECT_REF" \
  -v environment="$TARGET_ENV" \
  -f supabase/verification/tenant_stage_7b_corrected_postflight.sql \
  > "$EVIDENCE_DIR/after/postflight.txt"
sha256sum "$EVIDENCE_DIR/after/postflight.txt" \
  > "$EVIDENCE_DIR/after/postflight.sha256"
```

Require unchanged ledger and fingerprint, zero direct-execution ledger rows,
zero nulls/mismatches, four validated FKs, one active canonical DFW
organization, zero active Oregon, exactly one matching provenance row, denied
non-owner provenance access, corrected RLS/grants/functions, and unchanged DFW
smoke behavior.

## 7. Cron restore

Only after postflight passes:

```sh
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  > "$EVIDENCE_DIR/restore/cron-restore.txt" <<'SQL'
SELECT cron.alter_job(3, active := true);
SELECT cron.alter_job(5, active := true);
SELECT cron.alter_job(6, active := true);
SELECT jobid, active, md5(command) AS command_fingerprint
FROM cron.job WHERE jobid IN (3,5,6) ORDER BY jobid;
SQL
sha256sum "$EVIDENCE_DIR/restore/cron-restore.txt" \
  > "$EVIDENCE_DIR/restore/cron-restore.sha256"
```

Require all three active and fingerprints unchanged. Restore failure is an
incident and blocks runtime adoption.

## 8. Final evidence validation

Copy `provenance-evidence-template.json` to
`$EVIDENCE_DIR/provenance-evidence.json`, populate it from the redacted files,
then create a component manifest that excludes the final JSON. Hash that
manifest into `append_only.bundle_sha256` in the JSON, validate the JSON, and
finally hash the complete immutable bundle. This avoids a self-referential
digest:

```sh
find "$EVIDENCE_DIR"/before "$EVIDENCE_DIR"/execution \
  "$EVIDENCE_DIR"/after "$EVIDENCE_DIR"/restore \
  -type f -print0 | sort -z | xargs -0 sha256sum \
  > "$EVIDENCE_DIR/evidence-components.sha256"
EVIDENCE_COMPONENT_SHA=$(sha256sum \
  "$EVIDENCE_DIR/evidence-components.sha256" | awk '{print $1}')
# Record EVIDENCE_COMPONENT_SHA as append_only.bundle_sha256 in the JSON.
"$NODE" scripts/validate-stage-7b-evidence.mjs \
  "$EVIDENCE_DIR/provenance-evidence.json"
find "$EVIDENCE_DIR" -type f ! -name bundle.sha256 -print0 \
  | sort -z | xargs -0 sha256sum > "$EVIDENCE_DIR/bundle.sha256"
```

Retain the manifest, candidate hash (not connection string), pre/postflight
outputs and hashes, cron evidence, redacted execution output/hash, operator and
reviewer approval references, final JSON, bundle hash, and CI/rehearsal links.

## Abort and forward recovery

Abort before mutation for any mismatch or missing evidence. After execution,
stop deployment/runtime adoption on transaction, provenance, verification, or
restore uncertainty. Do not drop objects, clear organization IDs, rewrite the
ledger, or rerun blindly. Record incident ID, containment, and either
`NO_FORWARD_REPAIR_REQUIRED` after complete success or a separately reviewed
forward-repair reference. PITR is permitted only under incident authority.
