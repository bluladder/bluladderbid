# BluLadder Klamath JobTread protected configuration

Status: **exact protected resolver prepared; runtime and traffic disabled**.

## Provider checkpoint

The intended authorized JobTread organization was reverified through its
signed-in administration surface. Three non-sensitive, single-value, optional
text fields now exist with the exact names `BluLadder Customer Reference`,
`BluLadder Location Reference`, and `BluLadder Booking Reference`. The existing
Customer Contact `Phone` and `Email` fields are the reviewed contact bindings.
The exact provider organization and field identifiers remain protected and are
not recorded here. A later protected checkpoint created one organization-scoped
Grant. Its value is absent from the repository and remains unconfigured and
unverified because the controlled security boundary stopped transmission
without a verified Pave response. No webhook was created.

## Secret and authority boundary

`jobtreadKlamathProtectedConfiguration.ts` is the only reviewed adapter from
Klamath's non-secret credential reference to server-side JobTread environment
material. It requires:

- one organization-scoped Grant Key;
- the provider organization identity;
- the exact five custom-field bindings; and
- the fixed four-service allowlist and configuration version.

The Grant Key, provider organization identity, and field identifiers live only
in protected Edge Function environment storage. Connector rows may contain
only the compiled credential reference and a lowercase SHA-256 provider-
organization fingerprint. Missing, malformed, duplicate, cross-organization,
or unknown configuration fails closed.

Read and write configurations are deliberately separate because the read plan
accepts no field bindings. Neither configuration contains the Grant Key. The
credential resolver returns it only for the one compiled Klamath reference.

## Still blocked

This module is not imported by a production entry point and performs no
provider request. Protected Grant storage and verification, protected
environment values, an inactive connector row, provider health/availability acceptance,
runtime deployment, pricing approval, contacts, messaging, telephony, site
publication, customer traffic, and activation remain separately gated.
