# DFW launch-readiness contract

`docs/launch/launch-readiness.json` is the machine-readable source of truth.
Run the canonical assessment with:

```bash
npm run launch:readiness
```

The command evaluates repository, configuration, hosted-environment, manual
acceptance, and actual-production scopes separately. It exits non-zero unless
every applicable gate is `PASS`.

CI runs `npm run check:launch-contract`, which validates the evidence and
classification contract without pretending protected or hosted behavior has
passed.

## Status meanings

- `PASS`: repository evidence proves the scoped behavior.
- `FAIL`: the scoped behavior was exercised and failed.
- `BLOCKED_PROTECTED_ACTION`: completion requires an explicitly authorized
  hosted, provider, deployment, credential, or production-data action.
- `NOT_IMPLEMENTED`: required repository functionality or acceptance coverage
  does not exist yet.
- `NOT_APPLICABLE`: the gate does not apply to the DFW launch candidate.

Mocks can establish repository readiness only. They cannot make configuration,
hosted-environment, manual acceptance, or production-verification gates pass.

## Current launch blockers

The current contract identifies eight repository-level launch gaps:

1. Public intake still lacks a terminal service-area gate, and a manual
   fallback can claim unproven notification.
2. Public booking does not yet enforce the deterministic DFW service-area
   contract before authoritative writes.
3. Public bid delivery lacks durable request idempotency.
4. Decline uses weak destructive authorization and can race conversion.
5. A quote awaiting manual conversion reconciliation can remain eligible for
   abandonment follow-up until repaired.
6. Recurring provider uncertainty still requires manual recovery, and a
   communication crash can duplicate provider delivery.
7. Voice remains a beta/dry-run channel and cannot enter the authoritative
   booking workflow.
8. Operators lack one unified launch diagnostic view spanning booking, bid,
   communication, follow-up, and voice outcomes.

The hosted security foundation, provider configuration, controlled synthetic
booking, and production verification remain protected-action gates.
