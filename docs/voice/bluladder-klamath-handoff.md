# BluLadder Klamath handoff

Status: updated manifest candidate prepared; owner approval, provider evidence,
hosted binding, deployment, owner QA, customer traffic, and activation remain
pending. BluLadder Klamath
is not mapped to DFW, published, or deployed by the DFW voice release.

## Signed-in provider inventory

The historical read-only signed-in Vapi inventory on 2026-08-15 proved that no isolated
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

The exact Klamath Vapi manifest candidate is prepared for owner approval in
`supabase/functions/_shared/voiceProviderKlamathConfig.ts`, at SHA-256
`f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1`.
Its review record is `docs/voice/bluladder-klamath-vapi-manifest.md`. The
candidate pins every provider-effective value locally and retains only a
type-only shared import. Owner approval has not been recorded; provider
provisioning, phone binding, hosted mappings, deployment, owner QA, activation,
and customer traffic remain blocked.

The pending sanitized post-provisioning handoff is
`docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json`.
It can qualify only for a later hosted tenant-binding review and cannot carry
raw provider identifiers, phone digits, credentials, headers, server URLs,
recipient details, customer data, or message contents.

Raw assistant creation must follow
`docs/voice/bluladder-klamath-vapi-raw-api-runbook.md`. The repository adapter
preserves the exact candidate manifest while avoiding the provider Explorer's
server-message array serialization defect. This does not itself authorize or
prove provider provisioning.

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

Current gate state is explicit: exact manifest owner approval is pending;
provider saved-state evidence, phone binding, hosted tenant mappings,
deployment, owner-controlled QA, customer traffic, and final activation are
incomplete.

## Rollback

Deactivate only the Klamath organization/provider mapping and return its phone
resource to the preserved isolated rollback assistant. Do not change DFW
resources. Durable link and transfer identities prevent a retry of the same
call from duplicating an accepted customer message or transfer request.
