# Protected launch state reports

The final evaluator accepts no repository document or fixture as production
evidence. Copy `protected-launch-evidence.template.json` to an approved evidence
directory **outside the repository** and place one unique JSON report beside it
for each state that is claimed as PASS.

Every report has this shape:

```json
{
  "schema_version": 1,
  "fixture": false,
  "evidence_type": "STATE-SPECIFIC TYPE BELOW",
  "state": "STATE_ID",
  "result": "PASS",
  "project_ref": "exact project ref",
  "environment": "production",
  "repository_sha": "40 lowercase hex",
  "authorization": {
    "id": "external approval record",
    "scope": "exact scope below",
    "operator": "canonical immutable operator subject ID",
    "reviewer": "different canonical immutable reviewer subject ID",
    "approved_at": "UTC timestamp before capture",
    "expires_at": "UTC timestamp"
  },
  "capture": {
    "started_at": "UTC timestamp",
    "completed_at": "UTC timestamp",
    "source_system": "CI, database, provider, deployment, or monitoring system",
    "immutable_record_id": "unique external evidence-system record"
  },
  "measurements": {},
  "attestation": {
    "reviewer": "same independent reviewer",
    "reviewed_at": "UTC timestamp at or after completion",
    "result": "APPROVED",
    "evidence_system_record_id": "unique external attestation record"
  }
}
```

For live evidence, `fixture` must be exactly `false`. The bundle state must
repeat the same project, environment, SHA, operator,
reviewer, authorization ID, completion timestamp, expiry, report path, report
SHA-256, and evidence kind. Reports and immutable record IDs cannot be reused.
Reports must be current, must follow dependency completion, and must be
independently attested in the approved evidence system. Every state needs its
own authorization ID and attestation record ID.

| State | `evidence_type` | authorization `scope` | required exact measurements |
|---|---|---|---|
| `REPOSITORY_READY` | `repository_validation_report` | `repository_validation` | `validation_exit_code=0`, `failing_tests=0`, `dirty_files=0`, `repository_gates_passed=13` |
| `CONFIGURATION_VERIFIED` | `configuration_verification_report` | `read_only_configuration_verification` | `unverified_required_surfaces=0`, `mutation_attempts=0`, `credential_values_captured=0`, `public_booking_enabled=false`, `provider_release_verified=true`, plus the SHA-256 and immutable record ID of the exact provider release-verification output |
| `DATABASE_RELEASED` | `stage7b_database_release_report` | `stage7b_schema_backfill_and_cron_window` | `psql_exit_code=0`, `provenance_rows=1`, `first_wave_nulls=0`, `lineage_mismatches=0`, `active_oregon_organizations=0`, `cron_jobs_restored=3` |
| `DEPLOYMENT_VERIFIED` | `production_deployment_report` | `production_deployment` | `deployed_sha_matches=true`, `disabled_probe_failures=0`, `public_booking_enabled=false` |
| `SYNTHETIC_BOOKING_PASSED` | `protected_synthetic_booking_report` | `protected_synthetic_booking` | protected identity true; customer/property/quote/active-booking/active-Jobber deltas after cleanup all `0`; exactly one canceled booking tombstone and one test-run audit row retained with the audit record ID; accepted communications `0`; duplicate effects `0` |
| `VOICE_CONNECTIVITY_VERIFIED` | `voice_connectivity_report` | `read_only_voice_connectivity` | live calls `0`; provider tools `0`; transfer destinations `0`; retained artifacts enabled `0` |
| `REAL_CALL_ACCEPTANCE_PASSED` | `real_call_acceptance_report` | `real_ai_voice_acceptance` | real-call scenarios `12`; offline-fault scenarios `3`; unexpected writes, retained PII artifacts, and unresolved incidents all `0` |
| `LANDING_PAGE_RELEASED` | `landing_page_release_report` | `public_landing_release` | CTA failures `0`; booking enabled `true`; active Oregon organizations `0` |
| `MONITORING_STABLE` | `production_monitoring_report` | `post_release_monitoring` | observation minutes at least `60`; unresolved P0/P1, alert failures, and duplicate effects all `0`; capture interval at least 60 minutes |

## Signed GO-owner decision

Structural validation alone is never a launch GO. After all nine reports are
captured and independently reviewed, hash the exact `evidence.json` bytes. The
approved external evidence system must produce a detached Ed25519 approval
matching `protected-launch-go-approval.template.json`. Its signing key and
private key must never be stored in this repository. The GO owner must be
independent of every state operator and reviewer.

Run the final decision with both out-of-repository files:

```bash
node scripts/evaluate-protected-launch.mjs \
  /restricted/evidence/evidence.json \
  --go-approval /restricted/evidence/go-owner-approval.json \
  --trust-key /approved/trust/go-owner-public.pem
```

The evaluator verifies the exact bundle hash, project, environment, SHA,
approval time, 24-hour maximum validity, trust-key fingerprint, GO-owner
independence, and signature. Without that verified signature it may report
`STRUCTURALLY VALID`, but it always remains `NOT READY`.
