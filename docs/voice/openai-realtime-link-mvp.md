# OpenAI Realtime link-first voice MVP

Status: repository implementation for issue #91; no provider or production
mutation is performed by this change.

## Decision

Keep Vapi as the inbound phone and telephony layer. Replace the legacy
per-turn Deepgram -> Supabase custom LLM -> Vapi TTS chain with Vapi's supported
OpenAI Realtime native speech-to-speech model. Reuse the production BluLadder
web application for the workflows that the owner reports are already reliable:

- exact pricing and new booking;
- existing-appointment view, reschedule, and cancellation;
- customer verification and Jobber-backed mutations within those web flows.

The phone assistant answers the small approved fact set in its versioned prompt.
For quote/new-booking intent it texts the online bid flow. For an existing
appointment it texts the secure customer portal. It does not calculate a phone
price or mutate Jobber.

This is the shortest launch path because it preserves the current phone number,
Vapi account, CallRail SMS path, customer portal, pricing engine, and booking
system. A Retell migration would add a new telephony/provider integration and
does not repair the unnecessary application round trips in the current design.

Provider references:

- Vapi OpenAI Realtime guide:
  <https://docs.vapi.ai/openai-realtime>
- Vapi custom-tool request and response contract:
  <https://docs.vapi.ai/tools/custom-tools>
- OpenAI Realtime model documentation:
  <https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini>

The Vapi-documented production identifier remains
`gpt-realtime-2025-08-28` until Vapi documents support for a newer Realtime
identifier. The repository must not assume that a model available directly
from OpenAI is already accepted by Vapi.

## Versioned provider target

`buildVoiceRealtimeMvpManifest()` is a new target alongside the unchanged
`buildVoiceBetaAssistantManifest()` rollback source.

The Realtime target has these deliberate properties:

- OpenAI Realtime model with the OpenAI `marin` voice;
- no separate transcriber configuration;
- no background sound;
- short responses, moderate speaking pace, no filler, no repeated questions;
- exactly two no-argument tools;
- no phone number, email, address, customer, quote, booking, price, or tenant
  authority supplied by the model;
- no transfer destination or direct appointment mutation;
- audio/video/PCAP recording and Vapi logging remain off;
- text transcript retention is on for owner-requested call QA;
- summary, structured-data analysis, and success evaluation remain off.

## Tool boundary

Both tools use the existing authenticated `voice-vapi-events` function:

| Tool | Customer result |
| --- | --- |
| `send_online_quote_link` | Canonical online bid/new-booking URL |
| `send_booking_management_link` | Canonical secure customer portal URL |

The webhook resolves the organization only from mapped Vapi assistant/phone
resources. The destination comes only from the provider's trusted call envelope.
Model arguments are ignored.

All suppression, opt-out, and contact-pause reads run concurrently before the
single durable outbox claim. The active-call tools and the final-event generic
fallback use the same call-plus-recipient outbox identity. Therefore:

- repeated tool calls execute one delivery attempt;
- provider retries and reconnects cannot redispatch;
- the first link purpose for the call wins;
- the generic hangup link cannot compete with an in-call link;
- a timeout or malformed provider result remains uncertain and is never spoken
  as success.

Only `provider_accepted` permits “sent” wording. `queued`, `uncertain`,
`suppressed`, `opted_out`, `paused`, `failed`, `unsupported`, and
`invalid_request` have explicit non-success wording.

## Latency claim boundary

Repository tests prove removal of the custom adapter and separate transcriber
from the target manifest. They also prove that the link tool executes one
bounded policy/read group and one outbox attempt. They cannot prove live carrier,
Vapi, OpenAI, Supabase-region, or CallRail timing.

After deployment, the controlled call must capture from Vapi's call record:

1. caller speech end to assistant audio start for a no-tool FAQ;
2. caller consent end to tool-call receipt;
3. tool-call receipt to tool result;
4. tool result to assistant acknowledgement;
5. provider acceptance to owner-device SMS receipt.

Do not advertise a latency improvement until those measurements exist.

## First controlled-call evidence (2026-08-09)

The first owner-controlled inbound call on the isolated Realtime assistant
completed in 105 seconds and proved that the architecture change removed the
legacy multi-second application turn loop. Vapi reported 1,450 ms average turn
latency, with 388 ms average transcription and 315 ms average endpointing.

The quote-link tool was requested twice, but no SMS outbox row or provider
attempt was created. Vapi stored its generic `No result returned` fallback for
both tool attempts. The repository response used an object in `result`; Vapi's
documented synchronous custom-tool contract requires `result` to be a
single-line string. The repair therefore:

- serializes the bounded `{ status, message }` evidence as one JSON string;
- accepts both documented `toolCallList` and `toolWithToolCallList` request
  representations;
- logs only the bounded tool-result count and status for the next controlled
  call, never caller data or provider identifiers;
- adds the approved scheduling answer: BluLadder is usually booking one to two
  weeks out, can sometimes schedule sooner, and confirms exact availability
  only after quote details establish job duration.

This repair does not add a new SMS path, modify pricing, mutate Jobber, or trust
model-supplied contact or tenant data.

## Fast-launch scope and deferred extensions

Launch readiness requires the two existing link tools to pass one controlled
call each. Human transfer is the next bounded addition after link delivery is
proven. Spoken canonical pricing and direct appointment mutations are deferred
from the fast launch: they remain feasible as separate server-owned tools, but
must not delay the DFW FAQ/link receptionist or the Southern Oregon rollout.

## Bounded release order

1. Review and merge the exact green PR for issue #91.
2. Deploy only `voice-vapi-events` from the merged release SHA.
3. Retrieve and preserve the current Vapi assistant and phone-resource IDs as
   the rollback target.
4. Reconcile a new isolated assistant to the Realtime manifest. Do not overwrite
   or delete the legacy assistant.
5. Verify raw saved state: model, voice, absent transcriber, exact prompt/tools,
   exact server URL/events, duration, transcript-on, recording/logging-off,
   no transfers, and unchanged credential presence.
6. Point the test phone resource at the verified Realtime assistant.
7. Reload the assistant and phone resource and compare their immutable IDs.
8. Place one separately approved owner-controlled call.

No SQL, migration, Lovable publication, pricing configuration, customer record,
Jobber record, campaign, CallRail configuration, or live-booking flag change is
part of this release.

## Controlled-call script

1. Call the owner-only test number.
2. Say: “What services do you offer?” Confirm a short, natural answer.
3. Say: “I need a quote for window cleaning.”
4. When offered a text, say: “Yes, text me the link.”
5. Confirm one spoken acknowledgement and one SMS only.
6. Open the link and confirm the existing online quote/booking flow loads.
7. In a second separately authorized call, say: “I need to reschedule an
   existing appointment.” Accept the portal text and confirm the secure portal
   loads without any customer detail being spoken on the call.
8. Review the text transcript and the measured timing boundaries. Do not place a
   direct voice booking, cancellation, or reschedule in this MVP.

## Rollback

Repoint the phone resource to the preserved legacy assistant ID, verify the
phone resource after save, and redeploy the prior `voice-vapi-events` bundle only
if the new webhook itself is implicated. Outbox identities prevent a release
retry from duplicating a link already accepted during the same call.

## ChatGPT Work operating model

Routine source changes, GitHub review/merge, Supabase deployment, diagnostics,
and release evidence can continue through connected ChatGPT Work conversations.
Vapi still requires one authenticated provider-control session for the bounded
assistant/phone reconciliation unless a supported Vapi connector becomes
available. Keeping Vapi avoids requiring the owner to create and maintain a new
Retell account during the urgent Southern Oregon launch.
