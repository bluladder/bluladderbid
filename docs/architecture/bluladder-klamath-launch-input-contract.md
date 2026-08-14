# BluLadder Klamath launch-input readiness contract

Status: **repository-only, fail-closed activation-review preparation**. This
contract does not activate Klamath, authorize customer traffic, or replace the
final protected launch evaluator and owner GO approval.

## Purpose

Issue #151 collects decisions that cannot be inferred. This contract turns
those decisions and later provider evidence into a deterministic list of
blockers, without storing protected values. It closes the gap between informal
checklists and the separately authorized activation window.

The safe template is
`docs/operations/bluladder-klamath-launch-inputs.template.json`. It must remain
blocked in the repository. A completed evidence envelope belongs in a
restricted external location, not in GitHub.

## Exact boundaries

- Owner decisions must approve the exact repository draft for business hours,
  territory/services, pricing/booking, site/branding, messaging compliance,
  and JobTread setup. The one intentionally incomplete draft field—active
  weekdays—must be supplied as a non-empty, valid owner choice. Changing any
  other draft value requires changing and reviewing repository authority first.
- Protected contacts are represented only by boolean presence. Phone numbers,
  email addresses, provider identifiers, URLs, credentials, tokens, headers,
  and customer data are not accepted.
- JobTread, Twilio, Vapi, hosted, deployment, CI, Secret Scan, and controlled-QA
  evidence are explicit independent gates.
- Unknown fields fail closed. Secret-like and provider-identifier-like field
  names receive a distinct blocker.
- DFW fallback, Klamath runtime routing, publication, pricing runtime, and
  customer traffic remain disabled while this contract is prepared.

## Outcome

The only successful outcome is `eligible_for_activation_review`. The evaluator
always returns `activationAllowed: false`. A later protected evidence bundle,
fresh exact-head checks, owner-controlled acceptance, and explicit signed GO
approval are still required before any activation mutation.
