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
The repository contract checker rejects `PASS` in any of those scopes. Live
promotion happens only in the separately signed protected evidence decision; it
never rewrites the repository-owned scorecard.

## Current launch blockers

The repository-verifiable launch gates are implemented and passing. Remaining
gates require imported evidence from separately authorized hosted database,
provider-configuration, deployment, synthetic-booking, real-call, public
release, and monitoring windows. Documentation or fixtures cannot satisfy
those gates.

Public quote email and SMS delivery now claim a stable semantic request in the
database before provider submission. Concurrent duplicates converge on the
claim, stale in-flight claims become `uncertain` instead of redispatching, known
retryable and terminal failures remain distinct, provider IDs are durable, and
the quote lifecycle and recipient lineage are checked server-side. Resend
webhooks use reclaimable processing claims, compare-and-set attempt updates,
and only acknowledge completion after all durable effects succeed.

Unified launch diagnostics now have an organization-scoped, deny-by-default
repository contract spanning booking, intervention, bid delivery, quote
response, communications, follow-up, voice, and launch incidents. Redacted
fixtures prove filtering, unresolved counts, and stale/concurrent resolution
guards. The admin surface remains explicitly disabled by default and labels
fixture mode as non-hosted evidence; hosted persistence, deployment, and
operator verification remain protected gates.

Voice repository readiness uses a trusted-provider-context adapter with only
`disabled` and `dry_run` modes. Unknown values including `live` fail closed,
the legacy live flag cannot unlock the mutation pipeline, caller-supplied
organization or confirmation cannot authorize a command, and dry-run receipts
are deterministic and explicitly no-write. Provider configuration, real-number
connectivity, the 15-scenario real-call pack, and production monitoring remain
separate protected/manual gates.

Recurring SMS and email delivery now use the same durable recovery posture as
public quote delivery. The queue assigns a stable semantic key and claim token
before provider submission, finalizes through compare-and-set updates, supplies
the stable key to Resend, and never requeues a stale or transport-uncertain
claim. Those outcomes remain `delivery_unknown` for operator reconciliation;
known provider rejections alone may enter the bounded retry schedule. This is
repository and migration-contract evidence only until the additive migration is
separately authorized and applied to the hosted database.

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

The final protected launch decision uses:

```bash
node scripts/evaluate-protected-launch.mjs \
  /path/to/captured-launch-evidence/evidence.json \
  --go-approval /path/to/captured-launch-evidence/go-owner-approval.json \
  --trust-key /path/to/approved-trust/go-owner-public.pem
```

It requires the nine ordered protected states to be `PASS` with current,
identity-bound, independently reviewed, hash-verified captured evidence, plus
an independent GO-owner Ed25519 signature over the exact bundle. Unsigned
evidence can be structurally valid but can never return launch READY.
