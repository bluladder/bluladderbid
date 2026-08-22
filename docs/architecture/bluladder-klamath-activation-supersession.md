# BluLadder Klamath activation supersession

Status: **owner-authorized release candidate; production execution remains
fail-closed until exact-head checks and hosted preflights pass**.

## Purpose

This package replaces the planned compliance-only Klamath switch with one
forward-only activation that uses the approved public phone and email channels,
the already-provisioned isolated Vapi resources, the approved Twilio messaging
lane, and two distinct private voice authorities.

The old migration
`20260815103000_bluladder_klamath_compliance_site_activation.sql` remains
byte-for-byte unchanged and must never be applied. It is classified as
`superseded_unapplied`; no fabricated migration-ledger entry, history repair,
include-all application, or weakened assertion is permitted.

## Public and private authority boundary

The public customer surface contains exactly two destinations:

- one phone contact for the owner-approved Klamath business number;
- one email contact for the no-license Google Workspace distribution address.

The Google Group and its single external-member handoff were verified with one
owner-authorized neutral message. The sanitized evidence is pinned in
`docs/operations/bluladder-klamath-email-routing.receipt.json`; no message
content or raw private member address is retained there.

Private destinations never appear in public contacts, client-visible config,
logs, or sanitized receipts. They are bound directly in protected hosted state
only after provider verification:

- `transfer_destination`: one verified primary, resolved only by the server;
- `operational_alert_recipient`: one different verified backup with the
  operational SMS/email authority.

The human-transfer tool stays zero-argument. Model- or caller-supplied tenant,
destination, recipient, phone, and email values have no authority. A successful
customer-link action still excludes human transfer later in the same call.

DFW remains on its existing unclassified primary recipient. The runtime keeps
that exact row as `legacy_shared`; it never falls back from Klamath to DFW.

## Transaction stages

1. Verify the public Workspace route and Twilio/Vapi resources read-only.
2. Stage exactly one inactive Klamath Twilio messaging connector, one inactive
   transfer destination, and one inactive operational-alert recipient through
   protected hosted administration. No private destination is committed to
   GitHub.
3. Apply only
   `20260822170000_bluladder_klamath_activation_supersession.sql` through the
   migration-aware mechanism. The transaction publishes the approved public
   phone/email, adds the two provider-resolution hashes, enables the messaging
   connector and separated authorities, activates the two counties, makes four
   services available and two manual-review, enables the approved v1 pricing
   snapshot, and stages the customer site with traffic still disabled.
4. Deploy only the affected current-main function, `voice-vapi-events`, and
   require the exact build marker plus authentication/health verification.
5. Enable customer traffic with the separately reviewed one-row cutover only
   after every staged postflight and DFW fingerprint comparison passes.

The Klamath JobTread connector remains inactive with runtime and webhook access
disabled. No customer record, membership, internal contact, credential, tool,
phone, assistant, number, or provider resource is created by this package.

## Pricing and services

Issue #151 already records owner approval for the Klamath pricing/booking and
territory/service inputs. The activated database snapshot is pinned to the
existing hosted SHA-256 fingerprint and the separately reviewed pricing
candidate digest. Only `window_cleaning`, `gutter_cleaning`, `house_wash`, and
`pressure_washing` become automatically available. Commercial exterior and
storefront work remain active but manual-review only.

## Rollback boundary

The migration is forward-only. Rollback means fail closed, not history rewrite:

- pause `customer_traffic_allowed` for the unique Klamath site;
- preserve the migration ledger and all provider/public evidence;
- retain the prior Edge Function version for controlled restoration;
- investigate before any further write or owner test.

No automatic database reversal, provider deletion, DFW routing, or secret
rotation is authorized.
