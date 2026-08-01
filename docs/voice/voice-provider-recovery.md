# Voice Provider Failure and Recovery Contract

This runbook describes behavior after an authorized provider action is eventually enabled. It does not authorize a live test, production mutation, paid message, or configuration change.

## Customer-language rule

Never translate “request started” into “completed.” Use the exact evidence:

- queued: “I’ve queued that message to be sent.”
- provider outcome unknown: “I couldn’t confirm that the message was sent, so I’ve saved the quote and flagged it for follow-up.”
- availability failure: “I can’t confirm live appointment times right now, so I won’t guess.”
- booking rejection: “The appointment was not booked.”
- selected slot lost: “That time is no longer available. No appointment was created.”
- provider accepted/local record unknown: explain that reconciliation is required and tell the customer not to repeat the request.
- reschedule rejection: explicitly preserve the existing appointment.
- cancellation uncertainty: do not call the appointment cancelled and do not repeat the destructive call.

## Recovery ownership

| Failure | Automatic action | Customer action | Staff action |
|---|---|---|---|
| SMS/email durably queued | existing outbox retry policy | wait; request another channel only as a new consented action | inspect attempt/outbox if retry exhausts |
| Provider acceptance uncertain | no blind retry | none required | reconcile by correlation/attempt id |
| Address component fails twice | preserve request/callback | optionally restate to staff | verify address and service area |
| Schedule stale | current authorized refresh path may run | wait or choose follow-up | inspect autosync freshness |
| Provider rate limit/timeout | no fabricated slot | retry later or request follow-up | inspect provider/runtime health |
| Slot lost | fresh read-only availability may run | select a new current option | none unless repeated |
| Booking rejected | no success claim; hold/retry behavior follows confirmed rejection contract | select another current slot | inspect reason if repeated |
| Provider accepted/local persistence failed | no automatic repeat | do not rebook | reconcile provider and local ledger |
| Reschedule rejected | old appointment remains | choose another current option | investigate if provider unavailable |
| Cancel outcome unknown | no retry and no cancelled claim | wait for confirmation | reconcile provider state urgently |

## Required audit correlation

Persist or retain only safe identifiers already supported by the target subsystem:

- conversation and quote-session references;
- quote id and complete quote identity/version;
- delivery attempt and provider message id when present;
- availability offer version, expiry, slot id, and booking-context key;
- booking id, booking version, idempotency key, and provider operation id;
- customer-safe reason code and timestamp.

Do not log full provider payloads, authorization headers, service-role keys, call recordings, or unredacted customer PII.

## Escalation thresholds

- address: two failed attempts for the same missing component;
- slot selection: existing bounded failure threshold;
- delivery: outbox/claim state determines retry; voice does not add its own retry loop;
- cancellation/reschedule: any uncertain destructive outcome requires reconciliation, not another call;
- cross-customer, cross-organization, unresolved identity, stale quote, unavailable duration, or unverified area: immediate fail-closed outcome.
