# BluLadder Klamath path-based compliance release

Status: **owner-authorized for direct Twilio/TCR vetting after guarded
publication**.

This is the forward-only alternative to the unsupported shared-project custom
domain configuration. It exposes only these public presentation routes on the
existing primary site:

- `https://bid.bluladder.com/klamath`
- `https://bid.bluladder.com/klamath/privacy`
- `https://bid.bluladder.com/klamath/terms`
- `https://bid.bluladder.com/klamath/contact`

It does not enable Klamath customer traffic, publish a contact destination,
collect a mobile number, create customer data, or activate messaging, voice,
CRM, pricing, quote, booking, portal, or provider runtime.

## 1. Freeze and review the exact candidate

1. Require a clean branch based on live `main` and a single scoped PR.
2. Recompute every artifact size, SHA-256, and the canonical bundle digest in
   `docs/operations/bluladder-klamath-compliance-copy-review-manifest.json`.
3. Record the exact candidate digest and the owner's bounded release direction.
4. Require exact-head CI and Secret Scan before merge.

Issue #151 records the owner's direction to reconcile the pages to Twilio's
published requirements and use Twilio/TCR carrier vetting as the external
review step. A separate legal review is not a release gate. This does not claim
that legal review occurred or guarantee carrier approval.

## 2. Preserve the shared production boundary

1. `bid.bluladder.com/klamath` renders the consent explanation.
2. The three exact compliance subpaths render only privacy, terms, and contact.
3. Every neighboring path, including `/klamath/services`,
   `/klamath/quote/*`, and `/klamath/customer-portal`, stays in the existing
   DFW application and gains no Klamath authority.
4. The path pages use immutable repository presentation data only. They do not
   call the public-site bootstrap, accept form input, or write hosted data.
5. The contact page gives only HELP and STOP instructions. It exposes no phone
   or email destination, accepts no request, and writes no customer data.

## 3. Publish and verify the frontend

1. Require Lovable to be synchronized to the exact merged release SHA.
2. Use the existing direct frontend Publish control; do not prompt Lovable AI,
   deploy an Edge Function, edit source, or change hosted data.
3. Verify all four exact paths from a fresh browser and direct HTTPS requests.
4. Verify the consent page has no form or mobile-number input, privacy and terms
   match the reviewed bundle, and contact exposes no protected destination.
5. Re-verify representative DFW routes and an unknown route for unchanged
   behavior.

## 4. Keep carrier submission separate

The approved `$15` campaign vetting charge and `$1.50/month` low-volume charge
authorize those fees only after the carrier-submission gates pass. Do not
submit or charge while any of these remain open:

- public HTTPS verification of all four paths;
- a truthful verbal-opt-in explanation and HELP/STOP support path; and
- exact signed-in provider form review showing no unrelated change.

Campaign submission does not authorize a phone-number purchase, Messaging
Service sender assignment, message, call, or runtime activation.

## 5. Retire the unsupported custom-domain attempt

Do not reconnect or make `klamath.bluladder.com` primary on the shared Lovable
project. Lovable redirected non-primary custom domains to the DFW primary, and
making Klamath primary would disrupt DFW. The remaining managed DNS preset is
not changed here because the provider groups it with the active DFW record; the
disconnected Klamath origin currently fails closed.
