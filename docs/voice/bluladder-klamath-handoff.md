# BluLadder Klamath handoff

Status: preparation only. BluLadder Klamath is not activated, mapped to DFW,
published, or deployed by the DFW voice launch-hardening release.

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
- Jobber connector capability, if Klamath will book into a separate account;
- bounded FAQ/branding prompt reviewed as BluLadder Klamath.

The assistant may answer the approved FAQ, text the canonical quote link, text
the secure appointment-management link, and request a live operator transfer.
Spoken canonical pricing remains a separate follow-on and must not block the
Klamath launch.

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
