# BluLadder Klamath JobTread protected configuration

Status: **protected configuration verified; deployed read runtime remains
fail-closed and traffic-disabled**.

## Provider checkpoint

The intended authorized JobTread organization was reverified through its
signed-in administration surface. Three non-sensitive, single-value, optional
text fields now exist with the exact names `BluLadder Customer Reference`,
`BluLadder Location Reference`, and `BluLadder Booking Reference`. The existing
Customer Contact `Phone` and `Email` fields are the reviewed contact bindings.
The exact provider organization and field identifiers remain protected and are
not recorded here. A later protected checkpoint created one organization-scoped
Grant. Its value is absent from the repository and is present only in the
protected hosted secret boundary. One bounded Grant-authenticated Pave read
returned HTTP 200, resolved exactly one intended organization membership, and
returned 24 custom fields with pagination exhausted. All five bindings matched
their reviewed name, type, and target contracts exactly once. No protected
value was inspected during the later presence reconciliation, no runtime
connector transport executed, and no webhook was created.

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

## Hosted configuration receipt

All seven required Klamath-only JobTread secret names are present exactly once;
values remain hidden. Exactly one connector row matches the compiled credential
reference, five approved capabilities, configuration version, and lowercase
SHA-256 organization fingerprint. It is inactive, runtime-disabled,
webhook-disabled, and has no webhook-secret reference. The runtime activation
flag remains absent.

## Still blocked

This module is imported only by the deployed Klamath admin/service read entry
point, which remains stopped by both runtime gates. No runtime provider request
or customer/provider mutation was made by this reconciliation. Controlled
health/availability acceptance, pricing approval, contacts, messaging,
telephony, site publication, customer traffic, and activation remain
separately gated.
