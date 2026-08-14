# BluLadder Klamath Phase 1F portal tenant lineage

Status: **complete; fail-closed runtime deployed**.
The exact migration passed its aggregate-only hosted preflight and postflight,
and its provider execution receipt and generated types are reconciled. The
seven reviewed portal Edge Functions were deployed together from reconciled
main `4ed37cff90e35aacfe9ffeb55c666e45f09396b4`; secret-free preflight requests
returned HTTP 200 from every function without customer or provider action. No
frontend was published. Klamath remains
provisioning and inactive with no customer, message, credential, or provider
action.

## Problem closed by this phase

`customer_accounts`, `customer_portal_sessions`, verification challenges, match
issues, and auth-link audit rows predated the organization foundation. Portal
data endpoints then aggregated a verified phone or email and selected customers,
quotes, and bookings without an organization predicate. That behavior is safe
only while the product has one tenant.

Phase 1F makes organization lineage explicit and changes every portal identity
and read decision to fail closed:

1. customer accounts inherit and must match their parent customer's
   `organization_id`;
2. portal sessions inherit and must match their parent account;
3. challenges, match issues, and auth-link events carry required organization
   lineage;
4. verified phone, verified email, authenticated-user, and customer email
   uniqueness become organization-scoped;
5. the opaque session-token hash remains platform-global so one bearer token
   resolves to only one session before any tenant-owned read;
6. portal customer, quote, and booking queries require the exact organization
   derived from the session or authenticated account; and
7. non-DFW appointment projection does not read the unscoped Jobber schedule
   mirror. The future JobTread adapter must supply Klamath schedule evidence.

## Server-derived site authority

New account, OTP, and authenticated portal entry points do not accept a client
organization ID. A browser `Origin` is only a selector. The server normalizes
it and resolves it against an exact active `organization_customer_sites` row
and one active organization. Mapping status, runtime routing, publication, and
customer traffic must all be active. Missing, malformed, preview, duplicate,
inactive, or partially enabled evidence is blocked before a challenge, account,
session, message, or data read.

The exact canonical DFW hostname retains an explicit static compatibility
match because the live DFW site predates `organization_customer_sites`. This is
an exact match, never a missing-authority or first-row fallback. Klamath's
current provisioning organization and disabled site therefore remain blocked.

## Migration stop gates

The canonical migration locks all lineage participants and aborts unless:

- the organization foundation exists;
- the exact DFW legacy organization is active;
- every existing account and session has one parent organization;
- normalized customer email has no within-organization collision; and
- Klamath remains provisioning with zero customer rows.

Only under those conditions may historical parentless challenge and audit rows
receive the bounded DFW compatibility lineage. Parent-lineage triggers and
composite foreign keys then prevent future mismatch. Tenant-aware RLS preserves
legacy DFW administrator visibility while requiring active organization
membership for other tenants.

## Hosted application evidence

The canonical payload was applied once as hosted execution version
`20260814062249`. The stored 16,195-byte statement matches the exact canonical
16,196-byte file after the provider's sole terminal-line-feed normalization;
its SHA-256 is
`c1a91dfcbf7a647b70dcc4490b786d3c3d62b5fd65a0735e69d0e15e3db2fa51`.
Postflight proved five required organization columns and foreign keys, two
composite lineage keys, two enforcement triggers, five RLS-enabled tables, six
reviewed policies, zero lineage mismatches, and unchanged DFW fingerprints.

## Release boundary

The reviewed portal Edge Functions are deployed and independently boot-verified.
Their authentication configuration and secret presence were preserved; the
deployment produced no repository, schema, data, frontend, or provider change.
Frontend publication remains unnecessary. Klamath activation remains blocked
after this phase; messaging/outbox lineage,
JobTread, provider resources, pricing, contacts, publication, controlled
acceptance, and explicit customer-traffic authorization still remain.
