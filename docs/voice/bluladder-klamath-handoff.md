# BluLadder Klamath handoff

Status: preparation only. BluLadder Klamath is not activated, mapped to DFW,
published, or deployed by the DFW voice launch-hardening release.

## Signed-in provider inventory

The read-only signed-in Vapi inventory on 2026-08-15 proved that no isolated
Klamath assistant or phone resource exists. Existing DFW and other non-Klamath
resources are preserved, and the inventory receipt does not authorize reuse,
editing, cloning, reassignment, or deletion of any of them. The sanitized
receipt is
`docs/operations/bluladder-klamath-vapi-readiness.json`; it contains counts and
boolean gates only, with no provider identifier, phone digit, credential,
header, or customer information.

Voice provisioning therefore remains a real launch gate. It requires a
separately reviewed Klamath assistant manifest with Klamath branding, tenant-
safe tool authority, privacy settings, server events, duration hooks, and
fail-closed mappings. The future phone resource must be isolated and bound
only after the intended local number and messaging/voice authority are
approved. No call is allowed until raw saved-state verification, tenant
resolution, messaging, operator-recipient, and rollback gates all pass.

## Name and boundary

The Southern Oregon organization is customer-facing **BluLadder Klamath**.
Do not use a generic “BluLadder Oregon” label in customer copy. DFW is not a
fallback tenant: a missing, inactive, ambiguous, or provisioning Klamath mapping
must fail closed without reading DFW pricing, customers, appointments, operator
contacts, provider connectors, or messaging configuration.

## Reusable launch surface

The link-first Realtime receptionist can be reused after Klamath has its own:

- active organization and territory mapping;
- Vapi assistant and phone-resource resolution keys;
- verified primary local operator recipient with phone and email;
- quote and customer-portal base URL/configuration;
- messaging sender and consent/suppression configuration;
- local pricing manifest and service-area rules;
- a verified JobTread connector for every capability Klamath will use;
- bounded FAQ/branding prompt reviewed as BluLadder Klamath.

The assistant may answer the approved FAQ, text the canonical quote link, text
the secure appointment-management link, and request a live operator transfer.
Spoken canonical pricing remains a separate follow-on and must not block the
Klamath launch.

Current repository evidence blocks activation until Klamath has organization-
scoped site/link authority, portal identity and appointment reads, messaging
and outbox lineage, background jobs, uniqueness decisions, and its own approved
pricing. JobTread remains unsupported until official documentation and the
authorized account prove the required capabilities. Missing support must fail
closed to manual review; it must never select DFW Jobber.

## Provisioning order

1. Create Klamath as inactive/provisioning with no legacy-default behavior.
2. Add and validate Klamath territory/service-area rules.
3. Install Klamath pricing and connector configuration; rehearse without live
   mutation.
4. Add a verified Klamath primary operator recipient.
5. Create isolated Vapi assistant/phone resources and tenant resolution keys.
6. Verify that every missing or conflicting mapping fails closed and never
   resolves to DFW.
7. Activate only after web quote, SMS, portal, FAQ, and transfer checks pass.
8. Run one owner-controlled Klamath call before exposing the number.

## Rollback

Deactivate only the Klamath organization/provider mapping and return its phone
resource to the preserved isolated rollback assistant. Do not change DFW
resources. Durable link and transfer identities prevent a retry of the same
call from duplicating an accepted customer message or transfer request.
