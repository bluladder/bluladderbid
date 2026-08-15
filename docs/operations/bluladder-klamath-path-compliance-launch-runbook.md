# BluLadder Klamath path-based compliance release

Status: **implementation prepared; immutable owner and qualified review gates
remain open**.

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
3. Record owner approval naming that exact new bundle digest.
4. Record a separate qualified legal/compliance review naming the same digest.
   Owner approval cannot substitute for qualified review.
5. Require exact-head CI and Secret Scan before merge.

Hard stop: the earlier custom-host bundle approval does not approve the new
path URLs or the new truthful verbal-consent explanation.

## 2. Preserve the shared production boundary

1. `bid.bluladder.com/klamath` renders the consent explanation.
2. The three exact compliance subpaths render only privacy, terms, and contact.
3. Every neighboring path, including `/klamath/services`,
   `/klamath/quote/*`, and `/klamath/customer-portal`, stays in the existing
   existing DFW application and gains no Klamath authority.
4. The path pages use immutable repository presentation data only. They do not
   call the public-site bootstrap, accept form input, or write hosted data.
5. The contact page stays visibly unavailable until the separately reviewed
   Klamath contact channels have reachability and publication evidence.

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

- immutable owner approval for the new bundle;
- qualified legal/compliance review for the same bundle;
- public HTTPS verification of all four paths;
- a truthful support/reachability path suitable for the campaign; and
- exact signed-in provider form review showing no unrelated change.

Campaign submission does not authorize a phone-number purchase, Messaging
Service sender assignment, message, call, or runtime activation.

## 5. Retire the unsupported custom-domain attempt

Do not reconnect or make `klamath.bluladder.com` primary on the shared Lovable
project. Lovable redirected non-primary custom domains to the DFW primary, and
making Klamath primary would disrupt DFW. The remaining managed DNS preset is
not changed here because the provider groups it with the active DFW record; the
disconnected Klamath origin currently fails closed.
