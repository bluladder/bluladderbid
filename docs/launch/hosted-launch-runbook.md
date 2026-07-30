# Hosted launch sequence

This is the dependency-ordered operator sequence for the DFW launch. Each row
requires its own recorded authorization. Completing one row never authorizes
the next. Commands and UI actions are instructions for a future controlled
window; this repository work performs none of them.

| # | Phase | Estimate | Preconditions | Authorized action | Expected/verification | Abort and containment | Evidence/state |
|---:|---|---:|---|---|---|---|---|
| 0 | Window control | 15m | Named operator/reviewer; independent GO owner; incident channel; PITR/backup; provider contacts | Create external evidence bundle from `protected-launch-evidence.template.json`; register the externally managed Ed25519 GO trust key; record project, SHA, approvals | Identities agree; the trust key is outside the repository; all protected states remain `NOT_EXECUTED` or `BLOCKED` | Any identity/role/approval/trust-key mismatch: do nothing | Window record |
| 1 | Repository freeze | 20m | Clean current main | Run the complete repository validation suite, then credential-leak detection and both inactive-region/campaign policy guards; retain hashed outputs | Clean main and all repository gates pass | Any test/diff/security failure: cancel window | `REPOSITORY_READY` |
| 2 | Configuration verification | 30–45m | Read-only provider/hosted authorization | Run the redacted structural checker and separately approved provider/UI read-only matrix | Project/account/routing/signature/sender/domain/DID bindings match; booking setting is false; no value disclosed | Missing, conflicting, mutating, or unverifiable check: stop before deploy | `CONFIGURATION_VERIFIED` |
| 3 | Containment deployment | 15m | Configuration and deployment authorization; repository PASS | Set `PUBLIC_BOOKING_ENABLED=false`, then deploy the two booking functions plus admin diagnostics for the exact SHA | Both write paths return 503 `PUBLIC_BOOKING_DISABLED`; admin shows current verified-disabled state; pre-gate rollback prohibited | Any new-write path or UNKNOWN state: keep false and deploy/recover only a known gate-bearing artifact | Containment deployment evidence feeds `DEPLOYMENT_VERIFIED` |
| 4 | Stage 7B preflight | 20m | Corrected candidate approval; cron window ready | Execute only corrected read-only preflight and identity/hash checks from its runbook | Ledger/provenance assumptions, row counts, RLS, cron, and DB/client versions match | Any stop condition: do not open transaction | Preflight bundle |
| 5 | Stage 7B transaction | 15–30m | Separate schema/backfill authorization; exact artifact hash | Pause/drain named cron jobs; run exact direct `psql` command once | One atomic commit; private immutable provenance row; no null/mismatch; hostile RLS passes | SQL error: transaction rolls back. Result uncertainty: do not rerun; inspect provenance | `DATABASE_RELEASED` |
| 6 | Cron restore/postflight | 15m | Transaction outcome known | Restore only recorded cron jobs; run verification SQL | Cron fingerprints equal before-state; no backlog anomaly; reviewer confirms | Restore failure: keep public booking disabled and incident-open | Included in `DATABASE_RELEASED` |
| 7 | Runtime/application deployment | 20–30m | Database released; deployment authorization | Deploy reviewed Edge Functions/frontend for exact SHA; keep booking disabled | Deployment IDs map to SHA; disabled probes and read-only smoke checks pass | Roll back deployment; booking remains disabled | `DEPLOYMENT_VERIFIED` |
| 8 | Synthetic booking | 25–35m | Deployment verified; protected identity authorization; public gate remains false | Follow `controlled-synthetic-booking.md`; use only the service-authenticated, run-scoped protected-test pathway | One DFW lineage, one provider visit, idempotent replay, no communication, zero active artifacts after cleanup, and exactly the bounded canceled-booking/test-run audit lineage retained | Verify public gate still false; never retry uncertainty; incident/cleanup | `SYNTHETIC_BOOKING_PASSED` |
| 9 | Voice connectivity | 20m | Vapi read/config verification authorization; booking disabled | Verify isolated DID → assistant → authenticated endpoints using no-write events | Correct org/resource mapping, dry-run only, retention controls, no tool/provider write | Detach/disable only with separate authorization; otherwise stop | `VOICE_CONNECTIVITY_VERIFIED` |
| 10 | Real-call acceptance | 75–120m | Connectivity and synthetic PASS; real-call authorization | Execute phone worksheet scenarios; fault-injection scenarios offline unless separately approved | All 15 pass, no unexpected write/message/transcript artifact | End calls; keep booking/landing disabled; open incident | `REAL_CALL_ACCEPTANCE_PASSED` |
| 11 | Landing release | 15–20m | All prior states PASS; release authorization | Deploy/route approved landing and set `PUBLIC_BOOKING_ENABLED=true` | CTA/mobile/privacy/attribution probes pass; Oregon remains inactive | Set booking false, revert routing/deployment | `LANDING_PAGE_RELEASED` |
| 12 | Observation | 60m minimum | Landing released; on-call staff active | Observe diagnostics, provider uncertainty, queues, errors, conversions, and duplicate effects | No unresolved P0/P1, alerts operational, normal queue/provider health | Set booking false; pause affected outbound controls; incident response | `MONITORING_STABLE` |

## Final decision

```bash
node scripts/evaluate-protected-launch.mjs \
  /path/to/captured-launch-evidence/evidence.json \
  --go-approval /path/to/captured-launch-evidence/go-owner-approval.json \
  --trust-key /path/to/approved-trust/go-owner-public.pem
```

The evaluator checks all nine states, dependency order, exact project and
repository identity, distinct operator/reviewer, authorization IDs, freshness,
expiry, required claims and measurements, state-specific report schemas,
external evidence-system attestations, unique artifacts, artifact existence,
SHA-256, and the separately supplied GO-owner signature over the exact evidence
bundle. The approval and trust key must be outside the repository. The precise
report contract is in
`protected-launch-state-reports.md`. Documentation, templates, repository
fixtures, missing files, wrong environments, stale evidence, or a downstream
PASS with an upstream non-PASS fail closed.

The public launch is GO only when the command reports all three:
`STRUCTURALLY VALID`, `GO-owner approval: VERIFIED`, and
`Protected launch: READY`. A structurally valid unsigned bundle remains NO-GO.
Any other output is NO-GO.
