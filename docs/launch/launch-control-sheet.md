# DFW launch control sheet

Keep this page open during the window. Detailed instructions live in
`hosted-launch-runbook.md`.

**Release:** SHA __________  Project ref __________  Window __________

**Operator:** __________  **Reviewer:** __________  **Independent GO owner:** __________
**External trust-key fingerprint:** __________  **Incident channel:** __________

| Checkpoint | State | Time | Evidence/authorization | GO owner |
|---|---|---|---|---|
| Clean main, full suite, Oregon/campaign guards | `REPOSITORY_READY` | ____ | ____ | ____ |
| Providers/project structurally verified; no sends | `CONFIGURATION_VERIFIED` | ____ | ____ | ____ |
| Public booking visible as **DISABLED** | deployment containment | ____ | ____ | ____ |
| Stage 7B exact hash/preflight/cron drain | database preflight | ____ | ____ | ____ |
| Atomic commit + provenance + RLS + cron restored | `DATABASE_RELEASED` | ____ | ____ | ____ |
| Exact SHA deployed; disabled probes pass | `DEPLOYMENT_VERIFIED` | ____ | ____ | ____ |
| One protected DFW booking, replay, cleanup | `SYNTHETIC_BOOKING_PASSED` | ____ | ____ | ____ |
| Isolated DID, auth, dry-run, retention | `VOICE_CONNECTIVITY_VERIFIED` | ____ | ____ | ____ |
| Fifteen voice scenarios signed | `REAL_CALL_ACCEPTANCE_PASSED` | ____ | ____ | ____ |
| Landing/CTA released; booking enabled | `LANDING_PAGE_RELEASED` | ____ | ____ | ____ |
| 60-minute observation; zero open P0/P1 | `MONITORING_STABLE` | ____ | ____ | ____ |

## Red stop card

Say **STOP**, record UTC time, and disable public booking immediately for:

- wrong project, SHA, organization, identity, provider account, or DID;
- uncertain migration, provider, booking, or communication outcome;
- any unexpected customer/provider write or message;
- duplicate customer/property/quote/booking/job/visit/message effect;
- DFW fallback from missing/ambiguous geography or any Oregon activation;
- false booking/notification/intervention claim;
- cross-tenant/customer access, secret/PII/transcript disclosure;
- cron restore failure or unresolved P0/P1.

Do not retry uncertainty. Do not improvise SQL, provider changes, or cleanup.
Preserve correlation/provider IDs and artifact hashes. The operator contains;
the reviewer owns the GO decision.

## Containment

1. `PUBLIC_BOOKING_ENABLED=false` (separately authorized operator action).
2. Keep landing unreleased. Revert routing/deployment only when the window
   authorization names the exact target and rollback artifact; otherwise stop
   and obtain authorization.
3. Pause the affected campaign/outbound surface only when its exact control is
   pre-authorized; otherwise stop and obtain authorization.
4. Stop voice tests; do not place another call.
5. Open an incident and reconcile before any resume.

Final evaluator:
`node scripts/evaluate-protected-launch.mjs /path/to/evidence/evidence.json --go-approval /path/to/evidence/go-owner-approval.json --trust-key /approved/trust/go-owner-public.pem`

`STRUCTURALLY VALID` without `GO-owner approval: VERIFIED` is **NO-GO**.
