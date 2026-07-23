# Phase 7: Voice Booking Integration — Architecture Plan (MVP Inbound Only)

## Scope

**In scope**
- Inbound voice calls answered by the AI receptionist (Vapi → CallRail number).
- Reuse the Phase 6 booking engine end-to-end: quote session, pricing, identity anchor, property profile, availability lookup, slot holds, reservation protection, atomic booking executor, reconciliation, outbox.
- Book the caller when identity + property + quote + slot are all confirmed on the call.
- Warm/blind transfer to a human when the AI cannot safely complete the booking.

**Out of scope (deferred)**
- Outbound calling
- Voice-driven reschedule / cancel
- Customer portal changes
- Upsell/subscription flows during calls
- Voicemail transcription workflows

## Architecture

```text
Inbound Call
   │
   ▼
CallRail tracking # ──► Vapi Assistant (STT + LLM + TTS)
                          │
                          │ tool calls (HTTPS)
                          ▼
              supabase/functions/voice-adapter
                (thin request router + auth)
                          │
                          ▼
              _shared/voice/voiceOrchestrator.ts
                (channel="voice" wrapper around
                 existing aiOrchestrator + tools)
                          │
        ┌─────────────────┼──────────────────────┐
        ▼                 ▼                      ▼
  quoteSession    availabilityLookup       identityAnchor
  bookingReadiness   slotHold             propertyProfile
                     executeSmsBooking (reused as executeBooking)
                          │
                          ▼
                Jobber + SMS confirmation
```

Voice is a **channel**, not a new pipeline. The orchestrator, tools, safety gate, readiness check, holds, and booking executor from Phase 6 are reused unchanged; voice only adds a channel adapter and a voice-specific presentation layer.

## Components

1. **Vapi Assistant config** (documented, not committed as code)
   - System prompt referencing existing sales-engine manifests.
   - Tool schema exposing the whitelisted subset below.
   - Server URL → `voice-adapter` edge function.
   - Transfer destination = Ben's cell.

2. **Edge function `voice-adapter`** (new)
   - Validates Vapi signature (shared secret).
   - Maps Vapi tool-call payloads → orchestrator invocations keyed by `call_id`.
   - Emits SSE/JSON tool results back to Vapi.
   - Persists per-call session pointer in `chat_conversations` (channel=`voice`).

3. **`_shared/voice/voiceOrchestrator.ts`** (new, thin)
   - Resolves/creates a `chat_conversations` row for the call.
   - Delegates to the existing `aiOrchestrator` with `channel="voice"`.
   - Applies voice-specific response shaping (short utterances, no markdown, digit-safe phrasing).

4. **Tool allowlist for voice (reused from Phase 6)**
   - `resolve_customer_identity`
   - `resolve_property`
   - `get_or_update_property_facts`
   - `calculate_bluladder_quote`
   - `get_quote_booking_readiness`
   - `get_available_slots`
   - `present_and_hold_slot` (voice variant: single slot at a time)
   - `confirm_and_book` (wraps `executeSmsBooking` with `channel="voice"`)
   - `request_human_transfer` (new, voice-only)

5. **Human transfer path**
   - Vapi `transferCall` triggered by `request_human_transfer` tool.
   - Reasons logged to `chat_conversations`: `unsafe_to_book`, `customer_requested`, `identity_ambiguous`, `payment_question`, `complaint`, `out_of_area`.
   - Fail-closed: any orchestrator error or safety-gate block ⇒ transfer, never silent fail.

6. **Confirmation & receipts**
   - After successful booking, reuse existing SMS outbox to send the confirmation to the caller's number.
   - No new email path in this phase.

## Data model changes

Minimal, additive only:
- `chat_conversations`: extend `channel` enum to include `voice` (already string-typed — no migration if free-form; otherwise a small CHECK update).
- New table `voice_call_sessions` (optional, deferred if `chat_conversations` suffices):
  - `call_id` (Vapi), `conversation_id`, `from_number`, `to_number`, `started_at`, `ended_at`, `outcome`, `transfer_reason`.
- No changes to `sms_booking_confirmations`, `slot_reservations`, or Jobber flow.

## Safety & reuse guarantees

- `executeSmsBooking` is renamed conceptually to `executeBooking` via a channel-agnostic export; the SMS path keeps its existing entry point. No behavior change for SMS.
- All Phase 6 invariants preserved: reservation protection during Jobber call, idempotency key stamped in Jobber notes, atomic outbox for confirmation, manual-review freeze.
- Voice cannot bypass `bookingReadiness`; the safety gate treats `voice` identically to `sms` for send-class actions.

## Deliverables for Phase 7 (this milestone)

1. `voice-adapter` edge function skeleton (auth + routing + tool dispatch).
2. `_shared/voice/voiceOrchestrator.ts` channel wrapper.
3. Voice tool allowlist + `request_human_transfer` implementation.
4. Channel-agnostic export of the booking executor (no logic change).
5. Vapi assistant configuration document under `.lovable/memory/features/voice-phase7.md`.
6. Deno tests: tool allowlist, transfer reasons, channel routing, readiness parity with SMS.

## Explicitly deferred

- Outbound calling / callbacks
- Voice reschedule / cancel
- Portal integration
- Upsell scripts
- Multi-language
- Live barge-in tuning beyond Vapi defaults

## Verification plan

- Unit tests for adapter routing, transfer classification, and channel-parity readiness checks.
- Dry-run against a staging Vapi assistant using the approved test identity (no live Jobber write).
- One controlled live inbound test after Ben's sign-off, using the existing live-test authorization pattern.

Return approval to proceed with implementation, or request scope changes before code is written.
