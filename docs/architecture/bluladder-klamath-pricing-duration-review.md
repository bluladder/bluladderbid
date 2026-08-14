# BluLadder Klamath pricing and duration review contract

Status: **repository-only candidate, owner approval pending, runtime disabled**.
This package cannot enable pricing, booking, customer traffic, or activation.

## Purpose

Issue #151 approves the independent Klamath pricing profile as a draft starting
point, but it does not approve those copied values as the final automated
pricing and duration contract. The first automated wave therefore needs one
exact, reviewable snapshot before protected launch evidence may mark
`klamath_pricing_and_duration_contracts_verified` true.

The safe template is
`docs/operations/bluladder-klamath-pricing-duration-review.template.json`. It
contains no customer, contact, credential, or provider value. Its owner
approval is pending and its contract-test evidence is false by design.

## Exact candidate boundary

- Automated candidate services are limited to residential window cleaning,
  gutter cleaning, house/soft washing, and pressure washing/flatwork.
- Solar-panel cleaning, Christmas-light installation, commercial exterior, and
  storefront window work remain manual review.
- The snapshot includes every price and modifier used by the four-service wave,
  the versioned productivity-based duration policy, zero Oregon general sales
  tax, the owner-approved travel rule, and the disabled DFW promotion.
- The pricing profile stays `draft`; pricing runtime, instant confirmation,
  customer traffic, and activation stay false.
- Any candidate drift, unknown top-level field, sensitive-looking field,
  missing bounded approval, or missing exact contract-test evidence blocks the
  pricing-and-duration gate.

## Approval boundary

A later protected review may copy this template, record a bounded owner
approval reference and UTC timestamp, and set `contractTestsPassed` only after
the exact pricing/duration contract suite passes. The evaluator can return only
`eligible_for_pricing_duration_gate`; it always returns
`activationAllowed: false`. Provider setup, deployment, controlled QA, and the
final signed activation review remain separate gates.
