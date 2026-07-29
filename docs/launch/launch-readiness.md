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

The current contract identifies four repository-level launch gaps:

1. Public bid delivery lacks durable request idempotency.
2. Recurring provider uncertainty still requires manual recovery, and a
   communication crash can duplicate provider delivery.
3. Voice remains a beta/dry-run channel and cannot enter the authoritative
   booking workflow.
4. Operators lack one unified launch diagnostic view spanning booking, bid,
   communication, follow-up, and voice outcomes.

Public one-time booking and recurring-plan creation now share a server-side,
geocoder-backed DFW eligibility gate before any customer, quote, booking,
provider, campaign, or communication mutation. Unknown, conflicting, partial,
out-of-area, provider-unavailable, and configuration-unavailable decisions fail
closed. Manual-contact copy distinguishes a durably recorded review item from a
failed intervention record. Durable retries are request-fingerprint bound and
replay before geocoding, so a later provider outage cannot contradict or
duplicate a prior outcome. Street number and route must agree with the provider
result in addition to city, state, ZIP, and country.

Configured manual-review geography is not mislabeled as excluded: it creates a
deduplicated `contact_requests` intervention item and reports
`intervention_recorded` only after that insert succeeds. Failure to persist the
item produces `intervention_record_failed`, direct-contact guidance, and no
booking, quote, campaign, or customer communication.

The booking writers preserve the current single-DFW schema only when the
protected Stage 7B `organizations` table is demonstrably absent. Once that
foundation exists, the canonical DFW organization must resolve active and the
customer, quote, and booking writes carry `organization_id`; lookup failure or
inactive state cannot fall back. Applying Stage 7B and proving those hosted
writes remains part of the separate hosted security gate, not this repository
PASS.

The hosted security foundation, provider configuration, controlled synthetic
booking, and production verification remain protected-action gates.
