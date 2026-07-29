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

The current contract identifies eleven repository-level launch gaps:

1. Public booking can claim confirmation after the local authoritative write
   fails and can fall through to client-supplied pricing.
2. Existing-customer Jobber paths select the first property instead of matching
   the submitted address, and missing address data defaults to Austin.
3. Public booking does not yet enforce the deterministic DFW service-area
   contract before authoritative writes.
4. Anonymous SMS event requests and suppression failures are not consistently
   fail closed, and campaign email bypasses the shared suppression contract.
5. Saved-quote communications and campaign events can use caller-supplied
   values instead of the persisted authoritative calculation.
6. Bid delivery state can claim email or SMS success without provider
   acceptance and lacks durable public-request idempotency.
7. Acceptance does not convert the quote, while decline uses weak destructive
   authorization and can race conversion.
8. A booked quote can remain eligible for abandonment follow-up.
9. Recurring workflow replay and communication crash recovery can report false
   success or duplicate provider delivery.
10. Voice remains a beta/dry-run channel and cannot enter the authoritative
   booking workflow.
11. Operators lack one unified launch diagnostic view spanning booking, bid,
   communication, follow-up, and voice outcomes.

The hosted security foundation, provider configuration, controlled synthetic
booking, and production verification remain protected-action gates.
