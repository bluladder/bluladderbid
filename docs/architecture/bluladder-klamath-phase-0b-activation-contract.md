# BluLadder Klamath Phase 0B activation contract

Status: **repository-only second-tenant gate**. BluLadder Klamath remains
inactive and may not receive customer traffic. This contract does not authorize
a merge, deployment, migration, production write, provider change, call,
message, credential action, frontend publication, or Lovable credit use.

This document supersedes the useful planning intent in draft PR #81 without
merging or modifying that stale branch. The customer-facing name is
**BluLadder Klamath**. Generic “BluLadder Oregon” wording is not approved for
customer copy.

## Authority and isolation

Klamath is a separate organization from BluLadder DFW. Its organization must be
resolved from trusted server evidence: an approved hostname/site mapping,
persisted organization-owned resource, active membership, verified territory
rule, or mapped Vapi assistant and phone resource. Browser organization IDs,
query parameters, caller ID, spoken locations, customer text, email addresses,
and model output are selectors only and never tenant authority.

Missing, inactive, provisioning, ambiguous, conflicting, or partially mapped
evidence must fail closed. Klamath must never inherit DFW customers,
appointments, quotes, pricing, discounts, availability, Jobber data, contacts,
messaging configuration, knowledge, provider resources, or background jobs.

The canonical future customer hostname is `klamath.bluladder.com`. It is
planning data only until separately mapped and verified. Any broader Oregon
hostname requires a later ingress/redirect decision and cannot silently become
Klamath authority.

## Approved planning contract

- Territory: Klamath and Lake counties, including rural and unincorporated
  addresses.
- Initial communities: Klamath Falls, Lakeview, Keno, Bly, Bonanza, Chiloquin,
  Sprague River, Malin, and Merrill.
- Operating bases: Klamath Falls and Bly.
- Initial residential services: window cleaning, gutter cleaning, house
  washing, and pressure washing/flatwork.
- Commercial and storefront work: manual review until separately approved.
- CRM: JobTread only. Jobber remains DFW-only and is never a fallback.
- Pricing: begin from a reviewed copy of DFW rules, stored as an independent,
  versioned Klamath profile that can later diverge without reading live DFW
  configuration.
- Tax: no general Oregon sales tax in the initial planning contract.
- Booking intent: instant confirmed booking, 9:00 AM–5:00 PM Pacific time,
  48-hour minimum notice, 370-day horizon, and 48-hour cancellation notice.
- Launch payments: no deposit or card authorization; payment after service.
- Quote expiry: 30 days. Existing price-assurance and seven-day rain-guarantee
  concepts require Klamath-owned published policy content before use.
- Contacts: local manager, public customer contact, and transfer/escalation
  recipient remain separate organization-owned roles even if one person fills
  multiple roles initially.

No real contact values, provider identifiers, credentials, customer data, or
destination details belong in this repository contract.

## Travel and deferred policies

A long drive begins beyond 45 minutes one way from the closest eligible base.
The planning target waives a travel charge for jobs of at least $500 and allows
an independently configurable fee below that threshold. A proposed $1-per-mile
mode and a flat-fee-by-location mode remain options. One-way versus round-trip
mileage is unresolved, so no automated travel price may be calculated yet.

Remote route days, snow, ice, wildfire smoke, freezing temperatures, spoken
pricing, and automated commercial quoting may remain deferred if the affected
request goes to manual review without guessing or falling back to DFW.

## Reusable DFW voice foundation

The proven DFW Realtime Link behavior is a template, not shared tenant state.
Klamath may later use the same bounded behavior:

1. send one requested secure quote link;
2. send one requested secure appointment-management link; or
3. request a human transfer with zero caller/destination arguments.

Klamath requires its own assistant, phone resource, provider mappings, prompt,
first message, FAQ, operator recipient, customer link authority, sender, and
suppression configuration. DFW provider resources and contacts remain
unchanged. A successful link and a transfer remain mutually exclusive within a
call, and uncertain provider outcomes must never be described as successful.

## Current activation blockers

The machine-readable register is
`docs/operations/bluladder-klamath-phase-0b-gates.json`. Current main proves the
following boundaries remain closed:

- public booking and service-area authority are explicitly DFW-only;
- pricing, availability, discounts, and booking execution reject non-DFW
  organizations;
- portal identity aggregation and Jobber appointment projection are not ready
  for a second active organization;
- customer link construction uses one global application base URL;
- SMS outbox/sender configuration is not organization-scoped end to end;
- Jobber autosync and communication workers are not proven tenant-aware;
- no JobTread runtime adapter exists;
- uniqueness classifications and customer-identity semantics require
  second-tenant decisions and implementation;
- hosted Klamath rows, contacts, mappings, provider resources, and account
  capabilities remain unverified.

## Activation rule

`activation_allowed` must remain `false` until every required gate is backed by
separately authorized hosted/provider evidence and the corresponding repository
implementation. Changing a document or manifest status cannot activate an
organization. Activation requires its own owner approval after exact-head CI,
Secret Scan, hosted verification, isolated provider verification, and
owner-controlled customer-journey tests.
