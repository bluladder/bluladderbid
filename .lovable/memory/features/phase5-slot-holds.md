---
name: Phase 5 - 8-Minute Slot Holds
description: Read-only revalidation + reservation RPC + local persistence; single active presentation per conversation; abandoned-hold expiration sweep.
type: feature
---
SMS availability presentation Phase 5 hold pipeline is split into three
strictly separated operations that MUST NOT be combined:

  1. `revalidateSelectedSlot()` — READ-ONLY re-query of the availability
     engine; returns the current crew_ids for the selected slot.
  2. `reserveAuthoritativeSlot()` — thin wrapper over
     `public.reserve_booking_slot`. Never writes to
     `sms_availability_presentations`.
  3. `persistHoldState()` — writes hold columns on the presentation row.
     Only called AFTER the reservation RPC returned ok.

Additional rules:
- A DB partial unique index enforces at most one `status='active'`
  presentation per conversation.
- `activate_presentation_atomic(id, sms_id, preview)` performs supersession +
  activation + prior-hold release in one transaction.
- `expire_stale_presentation_holds()` sweeps abandoned 8-minute holds,
  calling `release_booking_slot` per group and flipping the row to
  `hold_status='expired'`.
- Customer identity is persisted on the presentation via
  `resolved_customer_id` + `identity_resolution_method` (canonical backend
  identity, not a hash — this is a backend-only table).
- Hold TTL is 8 minutes. Never call reservation from
  `handleSlotSelectionReply` without first releasing any prior hold this
  presentation was carrying (customer_changed_selection path).
- No YES parsing, no booking creation, no Jobber write, no confirmation
  ledger belongs in this phase.