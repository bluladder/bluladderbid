# Voice Beta — Dynamic Transfer Contract (Phase 4C-α, forward-looking)

This document records the provider-independent contract for the future dynamic
human-transfer flow. **No live transfer is implemented in Phase 4C-α.** No
Vapi API is called. No CallRail routing changes are made.

## Roles (canonical, active)

| Role | E.164 | Notes |
| --- | --- | --- |
| AI entrance (CallRail forwarding target) | `+14697472877` | Public AI voice + SMS line. |
| Configurable human transfer destination — Ben's cell | `+14692150144` | Read only from `VOICE_HUMAN_TRANSFER_NUMBER`. Never in prompts or dispositions. |
| Primary BluLadder business number | `+18662422583` | Used for public copy where applicable. |

## Retired

| E.164 | Reason |
| --- | --- |
| `+14692426556` | Former ResponsiBid integration line. Retired from BluLadder Bid for voice, SMS, transfer, booking, support, public display, AI prompts, and provider configuration. Rejected by `voiceTransferResolver.ts`. |

## Future flow (Phase 4C-β)

1. `runOrchestrator({ channel: "voice" })` returns a `VoiceDisposition` of
   `transfer_human`. **The disposition never contains a phone number.**
2. The voice adapter converts it into an `AdapterAction` of
   `request_transfer`.
3. A separate transfer endpoint calls `resolveTransferDestination()` to read
   `VOICE_HUMAN_TRANSFER_NUMBER` from server-side configuration and normalize
   it to E.164.
4. All loop guards must pass:
   - not `missing` or `invalid`
   - not the AI entrance (`+14697472877`)
   - not the current inbound caller ANI (`self_transfer`)
   - not the receiving DID for this call (`provider_did`)
   - not a retired number (`retired_number`)
   - not any known forwarding loop (`known_forwarding_loop`)
5. The provider's dynamic-transfer tool supplies a live call-control URL.
   The server sends a provider-native transfer command to that URL. In
   Phase 4C-α this step is not implemented.
6. Vapi (or the selected provider) attempts the transfer.
7. If the transfer fails or the destination does not answer, the caller
   returns to the approved fallback flow and BluLadder persists a callback
   request through `runOrchestrator()`.

## Non-negotiable constraints

- The transfer destination is read ONLY from server-side configuration.
- The language model may not select or alter the destination.
- The destination is never placed in the orchestrator prompt.
- The destination is never placed in the `VoiceDisposition`.
- The destination is never exposed to client-side code.
- Ordinary logs mask the destination as `***-***-0144`.
- A static destination is never configured inside a Vapi prompt or
  model-generated argument.

## Warm-transfer verification (deferred to Phase 4C-β)

Before enabling live transfers, Phase 4C-β must confirm whether the selected
provider's warm-transfer mode can:

- ring Ben's cell,
- determine whether a human answered,
- avoid completing the transfer to voicemail,
- return the caller to the original assistant after a failed transfer,
- trigger callback capture.

If a dedicated "transfer assistant" is required for that provider-native
behavior, it must be limited to:

- confirming a human answered,
- providing a brief handoff,
- completing or cancelling the transfer.

That assistant MUST NOT make pricing, booking, eligibility, or customer-identity
decisions.