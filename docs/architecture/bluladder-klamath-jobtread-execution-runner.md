# BluLadder Klamath JobTread execution and reconciliation runner

Status: **dormant repository contract prepared**. A later protected checkpoint
created one organization-scoped Grant, but it is not configured or verified.
This stage creates no Grant, connector row, webhook, custom field, provider
request, customer record, job, task, deployment, activation, or customer
traffic. No production Edge entry point imports the runner.

## Trust boundary

The public runner request contains only the server-resolved BluLadder
organization, approved connector capability, an opaque internal execution
reference, and—only for a write—a stable idempotency key. It cannot contain a
provider organization, connector, credential reference, provider record,
query, query root, mutation flag, destination, or retry policy.

Five injected server-owned ports provide the rest of the authority:

1. the connector store returns organization-scoped Phase 1I connector rows;
2. the prepared-plan source returns one already-approved mapping plan, exact
   configuration version, provider organization, and expected parent lineage;
3. the protected resolver exchanges only an opaque credential reference for
   Grant Key material in memory;
4. the operation-attempt store atomically claims and completes the Phase 1I
   hashed audit row; and
5. the transport performs exactly one Pave request.

The runner requires exactly one active, runtime-enabled JobTread connector for
the same organization and capability. It compares the configured lowercase
SHA-256 provider-organization fingerprint with a digest computed locally from
the protected plan authority. Configuration-version or lineage drift fails
closed before secret resolution, attempt claiming, or transport.

## Idempotency and reconciliation

Canonical JSON sorts object keys while preserving array order. The runner
hashes the complete approved plan/configuration contract into the Phase 1I
request fingerprint and hashes the tenant/connector/capability/idempotency
tuple separately. Raw idempotency keys, requests, customer data, provider
responses, and provider identifiers are never written to the audit port or
returned in a result.

Every mutation must claim attempt number one before transport. Duplicate,
conflicting, or in-progress claims fail with terminal manual review and never
reach JobTread. The runner never retries a mutation. A transport interruption,
server-side uncertainty, malformed mutation success, response-lineage drift,
or failure to complete the success audit remains outcome-uncertain and requires
reconciliation. Only a validated provider reference digest may be stored.

Reads do not create operation-attempt rows. A future entry point may implement
bounded read retry, but this dormant runner itself makes one transport call.

## Response validation

The executable step matrix admits only the reviewed mapping roots:

- grant membership/API-version health;
- one-account external-reference lookup;
- account, contact, and location create/update;
- bounded scheduled-job-task reads;
- job creation, scheduled-task creation, and scheduled-task update.

The runner validates the exact step/capability/mutation/root contract before
transport. It rejects Grant Key material and all blocked mutation roots. The
response must echo the expected provider organization and every applicable
account, contact, location, job, task, and schedule lineage. Customer lookup
must resolve zero or one record; paginated or multiple matches are ambiguous.
The returned value contains only the step, record count, and whether a next
page exists.

Quote/document, cancellation, invoice, provider communications, daily-log,
file, photo, and case-study lifecycles remain blocked. There is no Jobber, DFW,
manual, or Google Calendar fallback.

## Remaining activation gates

This module is deliberately unreachable. Before any provider or customer
traffic, separate reviewed stages must still:

1. store and verify the created organization-scoped Grant and record the
   created fields' protected bindings while preserving the reviewed first-wave
   no-webhook mode;
2. insert one inactive Klamath connector row using protected references and
   provider fingerprints;
3. adopt the prepared dormant composition through protected concrete context
   and configuration adapters; authenticated webhook receipt processing remains
   future-only;
4. prove capacity, crew, route, blackout, and cancellation semantics;
5. adopt the runner in only the exact organization-owned runtime entry points;
6. deploy and run owner-controlled provider acceptance; and
7. activate the connector only after pricing, contacts, messaging, site,
   telephony, and every customer-traffic launch gate passes.
