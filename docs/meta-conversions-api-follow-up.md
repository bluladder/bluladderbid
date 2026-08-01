# Meta Conversions API follow-up contract

## Current boundary

The application has no existing secure Meta Conversions API delivery path. This
change therefore keeps browser Pixel delivery only and does not add a database
migration, server secret, webhook, or production configuration. Browser events
use the versioned event ID contract in
`src/lib/attribution/metaEventContract.ts`, which a future server sender must
reuse byte-for-byte for deduplication.

The existing consent UI does not expose a marketing-tracking choice. The
internal consent contract accepts `granted`, `denied`, or `unknown`; an explicit
`denied` state blocks Meta loading and event delivery. A product-approved
consent control must call `setMetaTrackingConsent` before any jurisdiction or
policy requires opt-in rather than the current unknown-state behavior.

## Durable outbox

A follow-up migration should add a tenant-scoped outbox with:

- a generated row ID and unique `event_id`;
- `event_name`, source entity type, source entity ID, and event timestamp;
- `organization_id`, consent state, action source, and event source URL;
- immutable custom data including authoritative value, `USD`, and service IDs;
- normalized-and-hashed customer data plus `_fbp` and `_fbc` when permitted;
- delivery state, attempt count, next-attempt time, and a sanitized provider result;
- created, updated, delivered, and terminal-failure timestamps.

The quote persistence transaction should enqueue `Lead`; the confirmed booking
transaction should enqueue `Schedule`. The producer must use the same canonical
entity and `buildMetaEventId` inputs as the browser. A unique event-ID constraint
and retry-safe worker must prevent duplicate delivery. `Purchase`, `Subscribe`,
payment, and maintenance-plan activation remain out of scope until authoritative
server-side business events exist.

## Delivery safeguards

- Keep the Meta access token server-only and never include it in browser builds.
- Fail closed on tenant ambiguity or explicit consent denial.
- Do not log raw email, phone, IP address, or user agent.
- Normalize and hash supported PII immediately before delivery.
- Retry transient failures with bounded backoff; retain terminal failures for
  manual review rather than silently dropping them.
- Send browser and server values from the same immutable authoritative record.
- Validate deduplication in Meta Test Events before production enablement.
