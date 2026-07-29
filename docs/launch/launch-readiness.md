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

The current contract identifies ten repository-level launch gaps:

1. Public intake still lacks a terminal service-area gate, and a manual
   fallback can claim unproven notification.
2. Public booking does not yet enforce the deterministic DFW service-area
   contract before authoritative writes.
3. Suppression reads do not consistently fail closed, and campaign email
   bypasses the shared suppression contract.
4. Saved-quote communications and campaign events can use caller-supplied
   values instead of the persisted authoritative calculation.
5. Bid email delivery can claim success without provider acceptance, and
   public delivery lacks durable request idempotency.
6. Acceptance does not convert the quote, while decline uses weak destructive
   authorization and can race conversion.
7. A booked quote can remain eligible for abandonment follow-up.
8. Recurring provider uncertainty still requires manual recovery, and a
   communication crash can duplicate provider delivery.
9. Voice remains a beta/dry-run channel and cannot enter the authoritative
   booking workflow.
10. Operators lack one unified launch diagnostic view spanning booking, bid,
   communication, follow-up, and voice outcomes.

The hosted security foundation, provider configuration, controlled synthetic
booking, and production verification remain protected-action gates.
