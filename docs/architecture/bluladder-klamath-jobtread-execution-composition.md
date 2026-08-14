# BluLadder Klamath JobTread execution composition

Status: **dormant repository contract prepared**. No production Edge entry
point imports this module. It creates no credential, connector, custom field,
provider request, attempt, hosted write, deployment, or activation.

## Exact routing

The composition constructs the reviewed read and write sources internally.
Health and availability go only to the read source. Customer sync and booking
create/update go only to the write source. Quote, cancellation, invoice,
communications, unknown, and malformed capabilities return no plan without
calling either protected source.

The runner remains the only executable boundary. It still requires one active,
runtime-enabled, organization-scoped connector; a matching configuration
version and provider-organization fingerprint; exact plan and parent lineage;
protected credential resolution; one mutation-attempt claim; one transport
call; and exact response validation. Mutation retry remains prohibited.

## Authority boundary

All stateful effects remain injected server-owned ports. The caller can supply
only an organization, approved capability, opaque execution reference, and a
stable idempotency key for writes. It cannot supply provider organization,
query, mutation flag, credential, destination, retry policy, configuration, or
provider state.

## Remaining gates

The composition is intentionally unreachable. Real protected context and
configuration adapters, custom fields, Grant Key, inactive connector row,
capacity semantics, a separately reviewed production entry point, deployment,
owner-controlled provider acceptance, and activation remain blocked. There is
no webhook, Jobber fallback, DFW fallback, customer traffic, or provider action.
