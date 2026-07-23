---
name: Voice Phase 7 — Inbound Booking MVP
description: Inbound voice booking reuses the Phase 6 pipeline; gated by VOICE_LIVE_BOOKING_ENABLED
type: feature
---
# Voice Phase 7 — Inbound Booking MVP

**Scope:** inbound voice only. No outbound, no reschedule/cancel, no portal work.

**Architecture:** voice is a channel on the existing pipeline, not a parallel stack.

- Vapi custom-LLM → `supabase/functions/voice-llm-adapter` → `_shared/voiceAdapter.ts` → `runOrchestrator({ channel: "voice" })`.
- Same tools, safety gate, readiness check, availability lookup, slot holds, reservation protection, `executeSmsBooking`, outbox, and reconciliation as SMS.
- Human transfer path already exists via `voiceTransferResolver` + `transfer_human` disposition; adapter maps to `AdapterAction.request_transfer`.

**Live-booking gate (`aiTools.ts` → `voiceLiveBookingEnabled`):**

- Default: `create_bluladder_booking` on `channel: "voice"` returns `voice_beta_dry_run` and never calls Jobber.
- `VOICE_LIVE_BOOKING_ENABLED=true|1|yes` routes voice through the shared booking pipeline.
- The flag only removes the voice short-circuit. All Phase 6 guards still apply downstream: readiness, test-identity suppression, one-time live-Jobber authorization, reservation protection, idempotency-keyed Jobber write, atomic outbox confirmation.

**Non-blocking follow-ups (deferred):**

- Live-reservation fixture for `executeSmsBooking_6b1_test.ts` (recorded in `sms-autonomous-booking-phase6`).

**Gated next step — DO NOT execute without explicit owner authorization:**

- `VOICE_LIVE_BOOKING_ENABLED` stays unset/false until Ben gives explicit go-ahead in chat.
- First live inbound voice test uses the existing live-test authorization pattern (protected test identity, one-time single-use Jobber write authorization).
- Do not flip the flag, do not run a live inbound test, and do not stage a production rollout on your own initiative — wait for an explicit approval message.