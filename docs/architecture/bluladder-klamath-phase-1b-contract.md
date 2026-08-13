# BluLadder Klamath Phase 1B inactive site and customer-link routing contract

Status: **repository-only, inactive routing implementation**. This phase
introduces an organization-scoped customer-site resolver and connects the
voice link tool to it. It does not publish the Klamath site, create its hosted
organization, send customer traffic, merge, deploy, migrate, change a
provider, create a credential, call, message, or consume Lovable credits.

## Outcome

Customer links are no longer allowed to use a global DFW URL for any trusted
organization. Both the in-call voice link tools and the generic end-of-call
bid-link fallback resolve exactly one customer-site record from the
organization authority already established by the authenticated Vapi resource
mapping. They send nothing unless all of these conditions pass:

1. the organization identifier is a valid UUID and matches exactly one route;
2. the organization and site mapping are active;
3. runtime routing and customer traffic are explicitly enabled;
4. the site is explicitly published; and
5. the base URL is credential-free HTTPS at the exact canonical hostname,
   with no port, path, query, fragment, or Lovable preview domain.

Missing, duplicate, inactive, unpublished, disabled, mismatched, or unsafe
routes return a non-PII `invalid_request` result before suppression reads or an
outbox delivery can occur. There is no geographic, first-record, hostname, or DFW fallback.

## DFW compatibility boundary

The already-live DFW organization retains one exact compatibility record for
`https://bid.bluladder.com`. It is selected only when the trusted organization
ID is the established DFW organization. DFW quote and booking-management link
paths, UTM attribution, message kinds, durable outbox identity, and
provider-evidence wording are otherwise unchanged.

This repository change is not deployed by Phase 1B. A future deployment still
requires its own authorization and exact-function verification.

## Klamath remains inactive

The Klamath configuration remains deliberately unable to resolve:

- hosted `organizationId`: null;
- organization lifecycle: `provisioning`;
- site mapping: `unprovisioned`;
- runtime routing: false;
- publication: false;
- customer traffic: false; and
- DFW fallback: false.

`klamath.bluladder.com` therefore cannot receive a link or customer request in
this phase. The Phase 1A exact-host resolver also remains disconnected from
live request handling. Its eventual route record must be assembled from
reviewed hosted organization/site evidence, not a browser-supplied identifier.

## Tests and machine gate

The Edge tests prove exact DFW compatibility, denial for an unknown tenant,
independent Klamath activation gates, unsafe URL rejection, duplicate-route
denial, and no suppression/outbox action for unrouted in-call and post-call
voice requests. The Phase 0B checker now recognizes this narrower
implementation while keeping its overall site/link gate blocked because
Klamath has no hosted active route.

The machine-readable Phase 1B gate register is
`docs/operations/bluladder-klamath-phase-1b-gates.json`; CI runs its checker
alongside the unchanged Phase 0B and Phase 1A gates.

## Remaining release gates

1. Complete the read-only hosted Supabase, JobTread, Vapi, and Twilio
   preflight without credentials or provider changes.
2. Provision and verify Klamath's hosted organization and exact hostname while
   all activation flags remain false.
3. Implement tenant-scoped quote, booking, portal, appointment, messaging,
   outbox, background-job, and JobTread paths.
4. Approve independent catalog, pricing, hours, contacts, messaging
   registration, number ownership, and Vapi resources.
5. Separately authorize migrations/data, deployment, provider setup, and
   owner-controlled tests in that order.
6. Activate only after every machine and hosted gate passes and the owner gives
   an explicit final approval.
