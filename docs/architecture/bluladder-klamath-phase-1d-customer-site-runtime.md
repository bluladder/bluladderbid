# BluLadder Klamath Phase 1D customer-site runtime contract

Status: **repository-only, inactive runtime implementation**. The hosted
Klamath foundation exists, but its organization and site remain provisioning,
unpublished, runtime-disabled, and closed to customer traffic. This phase does
not activate, deploy, publish, message, call, create a provider resource, change
a secret, consume Lovable credits, or mutate hosted data.

## Outcome

Voice customer-link and post-call link paths now load the customer-site record
for the server-resolved organization instead of treating the static DFW URL as
the only production route. The bounded loader:

- accepts only a valid server-resolved organization UUID;
- preserves the exact DFW compatibility route for the established DFW UUID;
- reads only that organization and its customer-site rows;
- limits both reads to at most two rows so ambiguity is observable;
- returns no route on read failure, missing organization state, or malformed
  evidence;
- lets duplicate valid site rows reach the pure resolver, which rejects them as
  ambiguous; and
- constructs only an HTTPS root URL from the stored canonical hostname, then
  reuses the existing strict URL validator.

There is no hostname, geography, first-row, client-provided organization, or
DFW fallback for another organization.

## Current hosted Klamath behavior

The exact Phase 1C hosted row loads successfully, then fails closed because the
organization is `provisioning`. Even if that lifecycle gate were changed alone,
the independent mapping, runtime-routing, publication, and customer-traffic
checks would still block delivery. Suppression reads and the durable SMS outbox
are not reached while any customer-site gate is closed.

The DFW organization retains byte-for-byte equivalent link behavior and does
not require a new DFW table row. This preserves the already-live customer URL
without turning it into a default.

## Verification and release boundary

Focused Deno tests cover exact DFW compatibility without a database read, the
current inactive Klamath state, a future fully active route, missing/malformed/
unreadable evidence, duplicate ambiguity, the live voice-link path, and the
pre-suppression inactive stop. The build marker advances to
`voice-realtime-link-mvp.8-tenant-site-runtime` so a future exact-function
deployment can prove which code handled a request.

Deployment remains separately gated. Klamath still needs approved business
hours, local contacts, JobTread, Twilio/Vapi resources, tenant-scoped portal and
messaging work, provider verification, controlled acceptance, and explicit
activation before customer traffic is allowed.
