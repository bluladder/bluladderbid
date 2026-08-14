# BluLadder Klamath JobTread Phase 1I webhook receipts

Status: **dormant repository contract prepared**. This adapter creates no
webhook, authentication secret, connector, credential, provider request,
customer action, deployment, activation, or traffic.
No production Edge entry point imports it.

## Input and storage boundary

The claim API accepts only server-derived organization and connector UUIDs, a
lowercase SHA-256 provider-event hash, a bounded normalized event type, a
lowercase SHA-256 payload fingerprint, an explicit authenticated-source proof,
and an optional normalized occurrence timestamp. There is no raw payload,
header, token, credential, provider identifier, customer data, destination, or
retry control in the public interface.

The adapter names the exact approved columns in
`organization_connector_webhook_receipts`. Every read is scoped by
organization, connector, and event hash and bounded to at most two rows. All
stored and returned rows must validate UUID, hash, timestamp, authentication,
status, failure-code, and lifecycle relationships. PostgREST error text is
replaced by fixed internal categories.

## Processing ownership

Processing ownership exists only when the direct insert returns the exact new
`accepted` row. An error or empty response never grants ownership. One
read-only lookup of the exact unique tuple classifies the existing row:

- a matching accepted row is `in_progress`;
- a matching terminal row is `duplicate`;
- event metadata or fingerprint drift is `conflict`; and
- no row, multiple rows, malformed state, or a read failure is unavailable.

Recovery therefore never authorizes duplicate event processing.

## Tenant-safe completion and reconciliation

Every terminal transition requires the organization, connector, and receipt
UUID and filters all three. Only an `accepted` row with no processing timestamp
may become `processed`, `ignored`, or `manual_review`. Manual review accepts
only the four failure codes already constrained by Phase 1I. A zero-row,
stale, cross-tenant, malformed, or failed update terminates with a fixed error.

Reconciliation is read-only and returns only normalized event metadata,
fingerprints, lifecycle state, authentication presence, approved failure code,
and timestamps. It cannot retry, resume, repair, or contact JobTread.

## Remaining activation gates

The store is deliberately unreachable. Separate reviewed work must still
implement webhook authentication before claim, authenticated event parsing,
protected plan persistence, provider credential and webhook setup, one
inactive connector row, runtime entry-point adoption, deployment, controlled
acceptance, and every Klamath business, pricing, messaging, telephony,
publication, and customer-traffic approval. There is no Jobber or DFW fallback.
