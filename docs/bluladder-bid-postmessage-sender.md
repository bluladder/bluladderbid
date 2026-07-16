# BluLadder Bid → BluLadder.com postMessage bridge (sender contract)

BluLadder Bid can be rendered standalone at `https://quote.bluladder.com`, or
embedded in the BluLadder.com marketing site inside an iframe overlay. When
embedded, Bid sends a small, sanitized set of analytics events to the parent
window using `postMessage`. This file documents the SENDER side; the receiver
lives in the marketing project (`src/lib/bluladderBidBridge.ts` and
`src/components/landing/BluLadderBidOverlay.tsx`).

**Sender implementation:** `src/lib/bridge/bluladderBidPostMessage.ts`

## Envelope

```ts
{
  type: "bluladder-bid-event",
  version: 1,
  event: "quote_started" | "quote_submitted" | "booking_completed" | "booking_failed",
  event_id: string,        // <= 200 chars, deterministic per event
  timestamp: string,       // ISO-8601
  payload: {
    // approved keys only — see below
  }
}
```

## Embed detection

Bid activates embed mode when both are true:

- `window.parent !== window`
- URL query has `embed=1` OR `embed=true`

Standalone visits without either value keep the full BluLadder Bid header/footer
and send no parent messages. There is only one embedded presentation mode.

## Approved query parameters

On load, Bid safely reads only these:

`embed`, `preselect_service`, `utm_source`, `utm_medium`, `utm_campaign`,
`utm_content`, `utm_term`, `fbclid`, `landing_page_slug`, `source_session_id`,
`parent_origin`.

Never read or persisted from URL:

- Customer name / email / phone / address / ZIP / freeform notes
- Authentication tokens

Values are trimmed and length-limited; malformed values are ignored.

## Allowed parent origins

Production origins are hard-coded and always allowed:

- `https://bluladder.com`
- `https://www.bluladder.com`

Preview origins are added ONLY through the single non-secret build variable:

```
VITE_BID_ALLOWED_PARENT_ORIGINS=https://preview.bluladder.com,https://staging.bluladder.com
```

No wildcards. No suffix or substring matching. No arbitrary `parent_origin` from
the query string is trusted without allowlist confirmation. Malformed URLs are
rejected.

## Parent-origin resolution order

1. `parent_origin` query parameter, IF it exactly matches the allowlist.
2. `document.referrer` origin, IF it exactly matches the allowlist.
3. Otherwise, no message is sent. Ever.

A supplied `parent_origin` that is NOT allowlisted is ignored (falling through
to the referrer step only if the referrer itself is allowlisted).

The sender always calls `window.parent.postMessage(msg, validatedOrigin)`.
It never uses `"*"` and never uses a caller-controlled string as the target.

## First-touch attribution

A single centralized module owns first-touch (`src/lib/attribution/attribution.ts`).
Storage key: `bluladder_attribution_first_touch`. The sender additionally merges
the first-touch context into every outgoing payload, and callers cannot overwrite
first-touch fields with later values.

`source_session_id` is either supplied via URL or created cryptographically the
first time attribution runs; the same value is reused across events. Event IDs
are DERIVED but distinct from the session ID and are unique per event kind.

`direct_unknown` never overwrites a known campaign attribution.

## Events

### `quote_started`

Fires ONCE per session, on the first meaningful quote-building action:

- A service is enabled by the customer, OR
- A required home detail is entered, OR
- The package builder is opened by the customer.

Does NOT fire because the iframe loaded, a component rendered, a preselected
service appeared, or the customer opened the overlay without acting.

Deterministic ID: `quote_started_<sourceSessionId>`.

### `quote_submitted`

Fires only after the server-authoritative pricing response returns a firm quote
with a real quote id and a finite positive total. Uses the SAME gate as the
Meta `Lead` event, and does not create a second `Lead`.

Deterministic ID: `quote_submitted_<quoteId>`.

### `booking_completed`

Fires only after the existing successful-booking gate: local booking id AND
Jobber visit id both present. Uses the SAME gate as Meta `Schedule` /
`CompleteRegistration` and does not create a second one.

Deterministic ID: `booking_completed_<bookingId>`.

### `booking_failed`

Fires only after an explicit final booking attempt reaches the authoritative
booking process and ends in a terminal failure. Does NOT fire for validation
messages, customer edits, closing the modal, slot-still-loading, temporary UI
errors, or slot conflicts / transient "busy" errors that recover.

Deterministic ID: `booking_failed_<bookingAttemptId>_<failureStage>`. Only the
sanitized machine failure category is included; no raw error text, provider
response body, Jobber payload, or stack trace.

## Approved payload keys

`source_session_id`, `landing_page_slug`, `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content`, `utm_term`, `fbclid`, `service_slug`,
`service_slugs`, `quote_id`, `quote_value`, `booking_id`, `booking_value`,
`currency`, `failure_stage`, `error_code`.

Rules:

- `currency` = `USD`.
- `quote_value` / `booking_value` finite in `[0, 999999.99]`.
- `service_slugs` bounded to the approved internal slugs.
- IDs are internal opaque identifiers, not customer-facing PII.
- Never Jobber IDs, technician names, crew assignments, contact info, property
  info, or raw provider errors.
- Values that look like an email or phone are dropped, even in approved keys.
- Unapproved keys are silently dropped.

## Deduplication

Sender-side dedup store: `bl_bid_sender_seen_event_ids_v1`
(sessionStorage, bounded). Deterministic event IDs guarantee that React
rerenders, StrictMode double-mounts, route remounts, confirmation-page
refreshes, quote/booking idempotent replays, and reopening the overlay never
resend the same event.

Storage failure degrades gracefully — the event may retry, but quoting/booking
is never blocked.

## Meta ownership (unchanged)

BluLadder Bid still owns:

- Meta `Lead` — fires after a firm canonical quote (`fireLead`).
- Meta `Schedule` — fires after a valid Jobber booking (`fireSchedule`).
- Meta `CompleteRegistration` — after a confirmed booking
  (`fireCompleteRegistration`).

The iframe bridge is only an additional sanitized signal to the parent site.
No new Meta Pixel call is added by the bridge.

## Failure isolation

The bridge NEVER blocks or changes quote generation, pricing, availability,
booking, Jobber sync, notifications, or cancellation. Any failure — storage,
event construction, or `postMessage` — is swallowed. Only a sanitized internal
diagnostic may be recorded.

## Example messages (fictional IDs)

```json
{
  "type": "bluladder-bid-event",
  "version": 1,
  "event": "quote_submitted",
  "event_id": "quote_submitted_q_ab12cd",
  "timestamp": "2026-07-16T14:22:31.104Z",
  "payload": {
    "quote_id": "q_ab12cd",
    "quote_value": 549,
    "currency": "USD",
    "service_slugs": ["window-cleaning", "gutter-cleaning"],
    "source_session_id": "sess_9f2e1a",
    "utm_source": "meta",
    "utm_campaign": "fb_window_cleaning_offer",
    "landing_page_slug": "fb-window-cleaning"
  }
}
```

```json
{
  "type": "bluladder-bid-event",
  "version": 1,
  "event": "booking_failed",
  "event_id": "booking_failed_k_3f8a_server",
  "timestamp": "2026-07-16T14:26:03.882Z",
  "payload": {
    "failure_stage": "server",
    "error_code": "server",
    "source_session_id": "sess_9f2e1a"
  }
}
```