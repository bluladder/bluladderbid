# BluLadder Klamath JobTread Phase 1I stores

Status: **bounded read runtime adopted in the repository; inactive and undeployed**. A later protected checkpoint
created one organization-scoped Grant, but it remains unconfigured and
unverified. These adapters create no connector, credential, webhook, customer,
JobTread record, deployment, activation, or provider request. One
admin/service-only repository entry point now imports the connector lookup for
bounded reads; mutation-attempt methods remain unreachable on that path.

## Exact persistence boundary

`createJobTreadPhase1IStores` maps the dormant execution runner to exactly two
already-applied Phase 1I tables:

- `organization_crm_connectors` supplies organization-scoped JobTread
  connector authority; and
- `organization_connector_operation_attempts` owns mutation idempotency,
  terminal outcome, and read-only reconciliation.

Every select names the exact approved columns and is bounded to at most two
rows so ambiguity fails closed. Returned rows are parsed into a smaller
internal shape. UUIDs, enumerations, timestamps, lifecycle relationships, and
lowercase SHA-256 fields must all validate before the runner may use them.
PostgREST error text is never returned.

## Claim ownership and ambiguous writes

A mutation owns attempt number one only when its direct insert returns the
exact started row with the expected organization, connector, operation,
idempotency hash, and request fingerprint. An insert error or empty response
does not grant ownership. The adapter immediately performs one read-only lookup
of the exact unique tuple:

- the same fingerprint and `started` state returns `in_progress`;
- the same fingerprint and a terminal state returns `duplicate`;
- a different request fingerprint returns `conflict`; and
- no row, multiple rows, malformed data, or a read failure returns a fixed
  unavailable error.

Recovery therefore never authorizes another provider mutation. Raw
idempotency keys, customer/provider payloads, provider identifiers, responses,
and credentials are outside this store contract.

## Terminal transitions and reconciliation

Success and manual-review completion update only one row still in `started`
state with a null completion timestamp. A stale or ambiguous update fails
closed. Success may store only a validated provider-reference digest.
Manual review admits only the four runner terminal codes and permits uncertain
outcomes only for provider unavailability or exhausted retries.

Reconciliation is read-only. It returns only lifecycle state, approved failure
code, uncertainty, request fingerprint, and optional provider-reference hash.
It never resumes, retries, repairs, or contacts JobTread.

## Remaining activation gates

The bounded read runtime remains inactive and there is no deployed Edge entry
point. Separate reviewed work must still complete protected credential and
inactive connector verification, deployment, controlled provider acceptance,
and all Klamath
business/contact, pricing, messaging, telephony, publication, and
customer-traffic approvals.
There is no Jobber or DFW fallback.
