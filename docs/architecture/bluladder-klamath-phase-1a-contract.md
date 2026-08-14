# BluLadder Klamath Phase 1A tenant and site authority contract

Status: **repository-only, inactive configuration**. This phase creates a
reusable, typed Klamath business profile and an exact-host authority resolver.
It does not connect either one to a live request path. It does not authorize a
merge, deployment, migration, hosted write, provider change, credential,
contact value, call, message, customer traffic, or Lovable credit use.

## Outcome

Phase 1A establishes one independent tenant key, customer-facing name,
canonical future hostname, branding profile, territory plan, initial service
catalog, booking policy, connector intent, communications intent, required
contact roles, and draft pricing profile. The implementation lives in
`packages/tenant-config` so later runtime phases can consume a reviewed
contract instead of scattering Klamath constants through DFW code paths.

The current Klamath site authority is deliberately unprovisioned:

- `organizationId` is null;
- lifecycle is `provisioning`;
- site mapping status is `unprovisioned`;
- runtime routing, publication, customer traffic, and activation are false;
- aliases are empty; and
- DFW fallback is false.

Therefore `klamath.bluladder.com` still fails closed in Phase 1A. The old
planning label `oregon.bluladder.com`, `www` variants, URL paths, invalid ports,
and browser-supplied organization identifiers cannot silently become tenant
authority.

## Trusted site authority

`resolveTenantSiteAuthority` accepts only a request hostname plus
server-supplied mapping records. Resolution succeeds only when exactly one
record matches the normalized hostname and that record has:

1. a valid hosted organization UUID;
2. an active site mapping;
3. an active organization lifecycle; and
4. an explicit runtime-routing flag.

Missing, invalid, unsupported, duplicate, ambiguous, unprovisioned, inactive,
or runtime-disabled evidence returns a typed blocked result. The resolver does
not accept a client organization ID and has no DFW default.

## Independent business configuration

- Public brand: BluLadder Klamath; Next Level Clean; approved blue/cyan palette
  and Montserrat Extra Bold heading intent.
- Locale: US English, USD, and `America/Los_Angeles`.
- Planned territory: Klamath and Lake counties, both inactive until hosted
  service-area verification.
- Planned first-wave residential services: window cleaning, gutter cleaning,
  house washing, and pressure washing/flatwork. Solar-panel cleaning,
  Christmas-light installation, commercial, and storefront work stay in manual
  review pending exact pricing, duration, and scope approval.
- Approved hours: 9:00 AM–5:00 PM Pacific, Monday through Friday. Saturday is
  manual request/review only and Sunday is closed. Instant confirmation remains
  disabled until the separate runtime and activation gates pass.
- Booking policy: 48-hour notice, 370-day horizon, 48-hour cancellation notice,
  30-day quote expiry, payment after service, and no deposit.
- CRM: JobTread only, unverified and credential-free. DFW Jobber fallback is
  prohibited.
- Communications: Twilio is the intended carrier for one number with voice and
  SMS. No number is provisioned, A2P registration has not started, and no Vapi
  import exists. The live transfer destination remains a separate role.
- Contacts: all operational roles are required but unconfigured. No digits,
  addresses, provider identifiers, or recipient details are stored here.

## Independent pricing draft

The Klamath draft explicitly copies the verified DFW numeric starting point
instead of importing the DFW fixture or reading live DFW configuration. This
lets Klamath diverge safely after owner review. The profile is version 1,
`draft`, and runtime-disabled.

Oregon's no-general-sales-tax rule is represented as a zero tax rate. The DFW
$99 promotion is copied for traceability but disabled. The owner-approved
launch travel policy includes 45 one-way minutes and a $100 flat charge below a
$500 subtotal, waived at $500 or more; unresolved remote routes remain manual
review and per-mile calculations remain deferred. The pricing profile and its
duration policy remain draft and runtime-disabled until their exact independent
verification gate passes.

## Remaining release gates

Phase 1A does not close the Phase 0B hosted/runtime blockers. The following
remain separately authorized work:

1. hosted organization, hostname, territory, catalog, hours, contacts, and
   pricing records while the tenant remains provisioning;
2. JobTread capability verification, credentials, adapter, webhooks, and
   idempotent synchronization;
3. tenant-scoped quote, booking, portal, appointment, messaging, outbox,
   background-job, link, and provider-event implementation;
4. Twilio number selection, ownership, registration, voice/SMS routing, and
   isolated Vapi resources;
5. deployment and read-only verification; and
6. owner-controlled acceptance tests followed by explicit activation approval.

The machine-checkable Phase 1A register is
`docs/operations/bluladder-klamath-phase-1a-gates.json`.
