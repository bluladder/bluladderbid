---
name: SMS Autonomous Booking Phase 6
description: End-to-end deterministic SMS booking pipeline with reconciliation and outbox safety.
type: feature
---
Phase 6 of the SMS autonomous booking pipeline is complete and approved. It comprises:

- **Phase 6A**: Transaction-safe booking confirmation with atomic claim/commit RPCs, hold-preservation across external Jobber calls, and deterministic YES parsing.
- **Phase 6B.1**: Ledger failure classification separating customer-retriable failures from reconciliation-only failures; manual-review freeze semantics.
- **Phase 6B.2**: Reservation protection (`executing` status on `slot_reservations`) and deterministic Jobber recovery via idempotency-key metadata lookup.
- **Phase 6B.3**: Atomic SMS outbox state machine for booking-confirmation messages and timezone resolution/persistence.

## Non-blocking test enhancement
Add a live-reservation stub to `executeSmsBooking_6b1_test.ts` so the four creator-branch tests can exercise `input_missing`, `external_outcome_unknown`, and `verified_terminal_rejection` classifications without short-circuiting at reservation protection. This is a coverage improvement only; production behavior is correct.
