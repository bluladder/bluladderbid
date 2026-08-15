# BluLadder Oregon Phase 0A readiness contract

Status: **repository-only contract and pure fail-closed tests**. Phase 0A does
not activate Oregon, change runtime behavior, create or apply migrations,
configure providers, publish through Lovable, or modify production data.

## Organization authority

BluLadder Oregon is a future organization separate from BluLadder DFW. Oregon
remains inactive/provisioning during Phase 0A and must never automatically fall
back to DFW configuration, customer data, contacts, pricing, availability, CRM,
or provider settings.

Future server-controlled authority keys are planned for:

- `oregon.bluladder.com`
- `klamath.bluladder.com`

Both hostnames are intended to resolve to the same Oregon organization in a
later authorized ingress phase. They are not active authority mappings in Phase
0A. Browser input, query parameters, submitted organization IDs, customer text,
email, phone number, caller ID, model output, and spoken city are never
organization authority. Unknown, inactive, conflicting, or ambiguous authority
must fail closed to manual review or an explicit blocked state.

## Territory

The intended Oregon launch territory is Klamath County and Lake County,
including remote, rural, and unincorporated addresses. Initial communities are
Klamath Falls, Lakeview, Keno, Bly, Bonanza, Chiloquin, Sprague River, Malin,
and Merrill. Initial operating bases are Klamath Falls and Bly. Individuals or
teams may later be assigned by territory and availability.

No Oregon territory becomes active in Phase 0A. Territory and location
configuration must eventually support individually selectable days of week and
remote-area route days, such as a future Lakeview route-day rule, but that
routing behavior is not implemented here.

## Services

Initial Oregon services are residential window cleaning, gutter cleaning, house
washing, and pressure washing/flatwork. Commercial and storefront requests must
enter manual review unless and until a later owner-approved service contract
changes that rule. No Oregon service becomes active in Phase 0A.

## Pricing and tax

Oregon will initially copy DFW's complete rates, packages, minimums, bundles,
recurring plans, discounts, and service rules. The resulting Oregon pricing
configuration must be independently adjustable and must never read DFW's live
mutable configuration as fallback. No prices, rates, discounts, packages,
bundles, recurring plans, taxes, or service rules are copied or implemented in
Phase 0A.

Oregon begins with no general sales tax. No tax or pricing runtime behavior
changes in Phase 0A.

## Travel

A long drive is more than 45 minutes one way from the closest eligible team
base. Jobs totaling at least $500 should waive a future travel charge. Below
$500, future configuration must support either configurable per-mile pricing or
a configurable flat fee by territory/location. The proposed initial per-mile
amount is $1 per mile.

The one-way-versus-round-trip mileage decision remains unresolved. Phase 0A
must not implement, calculate, or silently resolve travel pricing.

## Booking and weather policies

Future Oregon booking intent is instant confirmed booking, 9:00 AM-5:00 PM
operating hours, 48-hour minimum booking notice, a 370-day booking horizon,
48-hour cancellation notice, no cancellation fee at launch, no deposit or card
authorization at launch, payment after service, 30-day quote expiry, the
existing DFW price-assurance promise, and the existing seven-day rain guarantee.
A future path for deposits or card authorization must remain possible.

Snow, ice, wildfire-smoke, and freezing-temperature policies remain deferred.
None of these settings becomes active in Phase 0A.

## CRM, providers, and contacts

Oregon's future CRM is JobTread. DFW continues using Jobber. Oregon must never
fall back to Jobber. JobTread remains unsupported/manual-review until official
capability and account validation are complete. Phase 0A performs no JobTread,
Jobber, Vapi, Twilio, Supabase, DNS, email, Lovable, or other provider call,
credential configuration, write, or production inspection.

Local-manager and public-customer-contact roles must remain independently
configurable, even if the same person initially occupies both roles. Real names,
email addresses, phone numbers, office addresses, credentials, and other
operational contact values must not be committed in repository documentation,
fixtures, or tests during Phase 0A. Oregon's operating-office address remains
unset.

## Phase 0A acceptance

Phase 0A is accepted only when repository-only documents and pure deterministic
tests prove the existing contracts fail closed for inactive/provisioning Oregon,
no Oregon-to-DFW fallback exists for pricing, contacts, territory, CRM, or
provider configuration, and no runtime/schema/provider/production change is
introduced.
