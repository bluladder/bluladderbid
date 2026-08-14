# BluLadder Klamath launch-input readiness contract

Status: **repository-only, fail-closed activation-review preparation**. This
contract does not activate Klamath, authorize customer traffic, or replace the
final protected launch evaluator and owner GO approval.

## Purpose

Issue #151 records the approved non-sensitive launch decisions. This contract
turns those decisions and later provider evidence into a deterministic list of
blockers, without storing protected values. It closes the gap between informal
checklists and the separately authorized activation window.

The safe template is
`docs/operations/bluladder-klamath-launch-inputs.template.json`. Its owner
approval entries reference issue #151, but all protected-presence, provider,
and release-evidence gates remain false, so it stays blocked in the repository.
A completed evidence envelope belongs in a restricted external location, not
in GitHub.

## Exact boundaries

- Owner decisions approve the exact repository draft for business hours,
  territory/services, pricing/booking, site/branding, messaging compliance,
  and JobTread setup. Monday through Friday are the approved instant-booking
  days; Saturday remains manual request/review and Sunday remains closed.
  Changing any approved draft value requires changing and reviewing repository
  authority first.
- The first automated-pricing wave remains limited to residential window,
  gutter, house/soft washing, and pressure-washing/flatwork. Solar-panel and
  Christmas-light work join commercial and storefront work in manual review.
  An independent pricing-and-duration verification gate remains false until
  exact Klamath contracts pass.
- Protected contacts are represented only by boolean presence. Phone numbers,
  email addresses, provider identifiers, URLs, credentials, tokens, headers,
  and customer data are not accepted.
- Pricing/duration, JobTread, Twilio, Vapi, hosted, deployment, CI, Secret Scan,
  and controlled-QA
  evidence are explicit independent gates. The first-wave JobTread gate is the
  reviewed server-initiated mode with its webhook absent, not an unsigned
  webhook workaround.
- Unknown fields fail closed. Secret-like and provider-identifier-like field
  names receive a distinct blocker.
- DFW fallback, Klamath runtime routing, publication, pricing runtime, and
  customer traffic remain disabled while this contract is prepared.

## Outcome

The only successful outcome is `eligible_for_activation_review`. The evaluator
always returns `activationAllowed: false`. A later protected evidence bundle,
fresh exact-head checks, owner-controlled acceptance, and explicit signed GO
approval are still required before any activation mutation.
