# Voice Beta — Isolated Vapi Provisioning (Phase 4C-β)

This document describes the exact owner actions required to stand up the
isolated Vapi test assistant that terminates in the BluLadder
`voice-llm-adapter`. It is authoritative for the direct-DID proof and is
deliberately narrower than any future production rollout.

The agent cannot open the Vapi dashboard, add provider secrets, or assign a
phone number. This checklist is the source of truth for the owner.

During Phase 4C-β, CallRail routing must not change, no CallRail SMS behavior
may change, no CallRail number may be forwarded, and human transfer to Ben's
cell (`+14692150144`) must remain disabled. The `VOICE_HUMAN_TRANSFER_NUMBER`
variable stays configured for a later phase and is not used here.

## Fixed active phone-number roles

- BluLadder Bid / CallRail AI entrance: `+14697472877` — routing unchanged.
- Primary BluLadder business number: `+18662422583` — untouched.
- Human-transfer destination (Phase 4C-γ, not used yet): `+14692150144`.
- Retired ResponsiBid: `+14692426556` — must remain retired.

## Owner-approved lower-cost provider privacy mode (mandatory)

The owner declined Vapi's paid Zero Data Retention add-on. This exception is
not equivalent to organization-level ZDR and must never be described as ZDR.
The assistant therefore disables every configurable Vapi call-content
retention surface while preserving only the reviewed server events needed by
the application.

1. Sign in to the Vapi organization used for this beta.
2. Open Organization Settings > Compliance.
3. Confirm Zero Data Retention is disabled and no ZDR billing change was made.
4. Confirm HIPAA mode is disabled.
5. Confirm recording, video recording, PCAP, logging, full message history,
   transcript retention, summary, structured output, and success analysis are
   all disabled.
6. Confirm the approved server URL and exact event allowlist remain configured.
7. During the separately authorized controlled-call window, place one short
   test call.
8. Open the completed call in the Vapi dashboard and confirm:
   - Operational metadata (call start/end, duration, status) is visible.
   - Raw audio/video/packet recordings, summary, structured output, and
     analysis are empty or unavailable.
   - The configured end-of-call event was delivered to the BluLadder event URL
     without requiring a Vapi-retained transcript or message history.
9. Stop if the dashboard or saved assistant re-enables any content-retention
   surface, silently removes required endpointing, or adds an unreviewed audio
   processor. Operational call metadata may remain under Vapi's ordinary
   account policy; do not claim otherwise.

BluLadder stores bounded, sanitized user/assistant turns for 30 days in the
tenant-scoped canonical conversation journal. Each new voice row carries an
explicit `retention_expires_at` deadline. Vapi transcript retention must remain
disabled. The approved expired-row purge procedure is described in
`docs/voice/issue-72-emergency-repair.md`.

## Supabase secrets

Add the following secrets in Supabase Edge Function Secrets. Values are never
checked into the repository.

- `VOICE_LLM_ADAPTER_SHARED_SECRET` — bearer token Vapi must send to
  `voice-llm-adapter`. Generate a strong random value.
- `VAPI_SERVER_SECRET` — shared credential Vapi must send as `X-Vapi-Secret`
  on every server event delivered to `voice-vapi-events`.
- `VOICE_HUMAN_TRANSFER_NUMBER` — leave configured as `+14692150144`. Not
  used during Phase 4C-β; it is enforced only in Phase 4C-γ.
- `VOICE_PROVIDER_DEBUG` — leave unset or `false` at all times except the
  single controlled payload-shape capture in a non-production environment.
  In production the debug flag is refused unless
  `VOICE_PROVIDER_DEBUG_PRODUCTION_OVERRIDE=true` is also present, which
  should be used only under explicit administrative approval.

## Vapi API-key credential (custom LLM)

1. Open Vapi > Providers > Credentials.
2. Create a new API Key credential.
3. Set the header name to `Authorization`.
4. Set the value to `Bearer <VOICE_LLM_ADAPTER_SHARED_SECRET>`.
5. Save. This credential is attached to the assistant's custom-LLM block.

## Vapi server-URL credential (server events)

1. In the same credentials area, create a shared-header credential.
2. Header name: `X-Vapi-Secret`.
3. Value: the `VAPI_SERVER_SECRET` you stored in Supabase.
4. Save. This credential is attached to the assistant's server URL.

## Assistant configuration (isolated)

Create a new Inbound Assistant using the values described in
`supabase/functions/_shared/voiceProviderConfig.ts`. The manifest is the
authoritative source of truth — this list mirrors it for convenience.

- Name: `BluLadder Voice Beta (isolated)` (31 characters; Vapi's current
  assistant-name limit is 40).
- Language: English only.
- Transcriber:
  - Primary: Deepgram `nova-3`, language `en`, smart formatting enabled, and
    the exact `keyterm` list in the manifest.
  - Fallback: AssemblyAI `universal-streaming-english`, language `en`, the
    exact `keytermsPrompt` list, and VAD-assisted endpointing enabled.
  - Automatic implicit fallback is disabled; only the explicit reviewed
    fallback is allowed. Publication must preserve
    `vadAssistedEndpointingEnabled: true` on that fallback.
- Start-speaking/turn detection:
  - `waitSeconds` = 0.4
  - Vapi smart endpointing enabled
  - punctuation wait = 0.3 seconds
  - no-punctuation wait = 1.2 seconds
  - spoken-number wait = 1.0 second
- Model: Custom LLM.
  - URL: `https://<project-ref>.supabase.co/functions/v1/voice-llm-adapter`.
  - Attach the API-key credential above.
  - Streaming: enabled.
- Tools: none. Explicitly clear the tool list — no transfer tool, no callback
  tool, no Jobber tool, no pricing tool, no booking tool.
- Artifacts: recording, video recording, PCAP, logging, full message history,
  and transcript retention all disabled. Summary, structured-data analysis,
  and success analysis remain disabled.
- No provider phone number pre-selected.
- Transfer destination: none.
- Duration:
  - `maxDurationSeconds`: 900.
  - `call.timeElapsed` hook at 780 seconds saying exactly:
    "Just a heads-up, we have about two minutes left on this call. I'll make
    sure you have a way to continue by text if we need it."
  - `call.timeElapsed` hook at 870 seconds saying exactly:
    "We have about thirty seconds left. I'll make sure we have the important
    details before the call ends."
  - Hard-cutoff message at 900 seconds:
    "We've reached the time limit for this call. Thanks for calling
    BluLadder. We'll be able to continue through our normal contact options."
  - Warnings must NOT promise a follow-up SMS.
- Artifact and analysis plan (verify each toggle):
  - `recordingEnabled` = false
  - `videoRecordingEnabled` = false
  - `pcapEnabled` = false
  - `loggingEnabled` = false
  - `fullMessageHistoryEnabled` = false
  - Transcript artifact delivery = disabled
  - Summary generation = disabled
  - Structured output = disabled
  - Analysis = disabled
- Server URL: `https://<project-ref>.supabase.co/functions/v1/voice-vapi-events`.
  - Attach the shared-header credential above.
  - Subscribed events: only `assistant.started`, `status-update`, `hang`,
    `end-of-call-report`. Do not subscribe to `tool-calls`,
    `transfer-destination-request`, or `handoff-destination-request`.

### Raw API reconciliation requirement

The Vapi CLI v0.2.1 typed assistant output is not release evidence because it
omits fields required by this manifest. Reconciliation must use the raw
`GET /assistant/:id` REST response and the bounded patch/verification helpers in
`voiceProviderReconciliation.ts`. Never print the raw response because it may
contain credential IDs or server-header values.

Before publication, capture a separately approved non-secret credential
fingerprint with `fingerprintVapiAssistantAuthority()`. Supply that fingerprint
to `verifyVapiAssistantSnapshot()` after publication. A missing, malformed, or
changed custom-LLM credential ID or server-event secret fingerprint fails the
release; credential values must never be printed or persisted as evidence.
Raw JSON object-key order is not provider drift, but array order, object shape,
field names, values, and credential fingerprints remain exact.

The outgoing PATCH includes `autoFallback.enabled: false`. Vapi documents
automatic fallback as opt-in and may canonicalize a saved false value by
omitting `autoFallback` from the raw response. Post-save verification accepts
only an omitted object or explicit false; explicit true always fails. Every
artifact field, manual fallback field, tool list, hook, endpointing value, and
server event must still be returned and verified exactly.

## Isolated test phone number

1. Purchase or reserve one US Vapi test number. Do not use CallRail.
2. Assign only the isolated assistant to this number.
3. Confirm no CallRail number is involved.
4. Confirm no transfer destination is configured.
5. Confirm `maxDurationSeconds` reads 900 and both time-elapsed hooks are
   present with the exact copy above.
6. Confirm recording, video, packet capture, logging, transcript retention,
   and full message history are disabled. Confirm only the reviewed
   end-of-call server event remains enabled.

## Direct-DID test order

See `docs/voice-beta-dynamic-transfer-contract.md` for the transfer contract
that remains deferred to Phase 4C-γ. During Phase 4C-β, run the tests in this
order and stop on the first failure:

- Test A (dashboard/browser call): Vapi reaches `voice-llm-adapter`, bearer
  auth succeeds, greeting is spoken, one grounded service reply is streamed
  correctly, no transfer or booking is attempted.
- Test B (direct PSTN call to the isolated Vapi number): greeting, barge-in,
  window-cleaning question, service-area question, quote discussion,
  availability question, booking request blocked by the dry-run safeguard,
  human-transfer request produces a safe "transfer is not available in this
  test" response, graceful hang-up, provider-ended-call behavior, end-of-call
  event delivered to `voice-vapi-events`, raw recording absent, and the
  bounded sanitized transcript present once in the tenant conversation.
- Test C (duration controls — only after A and B pass): one controlled
  15-minute call verifying the 780s warning, the 870s warning, hard
  termination at 900s, no unimplemented SMS promise, no raw recording, and no
  duplicate transcript rows.

## Owner completion signal

After each test, capture only sanitized results (event names observed, timing,
which allowlisted server events fired, presence-only shape summary from the
`VOICE_PROVIDER_DEBUG` capture) and return them for the Phase 4C-β signoff.
Do not paste transcripts, full phone numbers, or provider secrets.
