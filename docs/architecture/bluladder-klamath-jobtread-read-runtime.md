# BluLadder Klamath protected JobTread read runtime

Status: **repository adopted, deployment and provider execution not performed**.

Issue #169 adopts the reviewed JobTread connector store, protected Klamath
configuration, read-plan source, execution runner, and Pave client behind one
production-shaped Edge Function. The boundary permits only `health` and
`availability_read`. It cannot construct or transmit a mutation.

## Two independent runtime stops

`JOBTREAD_KLAMATH_READ_RUNTIME_ENABLED` must be the exact string `true` before
the boundary reads the connector, protected configuration, credential, or
transport. The hosted value remains absent/disabled. Even if that flag is later
enabled, the existing runner independently requires exactly one active,
runtime-enabled JobTread connector with the exact Klamath organization,
capability, credential reference, configuration version, and provider-
organization fingerprint. The staged connector remains inactive and
runtime-disabled.

## Authority and request shape

Only an operations admin or an internal service caller may reach the handler.
The organization is compiled to BluLadder Klamath and cannot be selected by the
caller. A request supplies one opaque execution reference and either a health
capability or a bounded availability interval plus a subset of the four
approved residential service keys. Unknown keys, write capabilities, duplicate
services, invalid dates, and intervals longer than 31 days fail before any
protected dependency.

The short-lived read context exists only in request memory for at most one
minute. The protected provider organization, field bindings, Grant, connector
identity, query, and raw provider response are never returned to the caller or
logged by this boundary.

## Provider and response boundary

The transport wrapper rejects `mutation: true` without calling `fetch`. The
existing Pave client injects the Grant only in the protected outbound body and
returns sanitized error categories. The execution runner validates the exact
query, organization fingerprint, response structure, and lineage before the
handler returns only the step, record count, and pagination presence.

## Still blocked

No function is deployed, no runtime flag or connector is enabled, no provider
request is made, and no customer, booking, message, call, webhook, or hosted
record is created by this repository change. Customer and booking writes need a
separately reviewed server-owned orchestration boundary and are not accepted by
this endpoint. DFW and Jobber fallback remain prohibited.
