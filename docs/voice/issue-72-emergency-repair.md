# Issue #72 — Voice form, transcript, and quote-delivery repair

Status: implementation contract for draft review. Nothing in this change deploys
or updates provider configuration.

## Repaired authority chain

The deterministic controller is the only voice intake state machine. Each
authenticated provider request follows this order:

1. Resolve the organization from trusted provider/resource mappings.
2. Normalize the latest caller answer into `QuoteSessionFields`, including
   field provenance.
3. Persist the quote-session patch with the expected organization and row
   version.
4. Project the persisted canonical session into the same-organization
   `chat_conversations` row through
   `buildQuoteSessionConversationProjection`.
5. When all identity prerequisites are explicitly confirmed, prepare the local
   tenant customer, property, and customer-property link without contacting
   Jobber or another provider.
6. Re-project resolved lineage.
7. Journal the exact caller and assistant turn with a deterministic provider
   call/turn key.

Persistence, projection, and identity conflicts fail closed. The assistant
states which part was saved and does not claim that availability, delivery, or
booking advanced.

## Canonical form projection

`supabase/functions/_shared/voice/quoteSessionProjection.ts` is the single
session-to-conversation adapter. It projects quote-session ID, services,
confirmed contact facts, the canonical address and service-area result, quote
result, conversation state, canonical facts, customer/property lineage, and
booking/slot state. Every read and write includes the server-derived
`organization_id`.

Existing verified or corrected values outrank captured, derived, defaulted, and
unanswered values. A lower-provenance projection cannot overwrite a verified
fact. Explicit corrections remain authoritative and the quote-session reducer
continues to invalidate stale price/availability state when price inputs
change. Optimistic row-version checks and one scoped winner reread protect
against interleaved projections.

## Local booking identity preparation

`voiceBookingIdentityPreparation.ts` runs only after the canonical session has:

- a verified/corrected first and last name;
- a verified/corrected normalized email;
- a confirmed E.164 phone;
- a verified/corrected canonical address;
- a verified eligible service-area result; and
- server-derived organization authority.

Customer lookup is tenant-scoped and requires an unambiguous normalized email.
Existing name or phone conflicts fail closed. New customer and property IDs are
deterministic, and insert races use exact tenant-scoped winner rereads. Property
resolution uses the normalized address inside the organization; an existing
active link to another customer is not silently reassigned. The preparation
step creates only local BluLadder records and never invokes Jobber.

## Address and contact confirmation

The controller stores address components independently, asks only for an
uncertain component, and confirms the final canonical address once after the
service-area lookup. Deliberate spelling and explicit corrections win over STT
history. Email uses specialized spoken-email parsing and a single natural
readback. First/last name, email, manually supplied phone, and final address
remain captured-but-unverified until an explicit confirmation.

The regression suite includes synthetic versions of the two incident paths:
5612 Binbranch Lane in McKinney and 720 Parkland Drive in Aubrey. No real owner
email or phone is committed.

## Actual quote delivery

An explicit request for the quote in writing, or an eligible final hangup,
first evaluates the current canonical quote session. A fresh firm quote with a
verified recipient is saved through the existing `save-quote` path and sent
through the existing `send-sms` path. The voice payload carries the canonical
price, tax, promotion, services, and line items; `save-quote` performs its
existing server-authoritative recalculation rather than trusting a second voice
pricing implementation. The saved quote's tenant, customer, property, session,
and conversation lineage must agree before `send-sms` can be invoked.

Delivery records `actual_quote` or `generic_fallback`. A generic bid-page link
is allowed only after the canonical actual-quote path returns a terminal
non-deliverable result. Queued, retry-pending, provider-uncertain, or locally
unconfirmed outcomes never fall through to the generic message. Success is
spoken only after durable provider acceptance and scoped local quote linkage.
Stable quote/session delivery keys preserve the existing suppression,
opt-out, pause, and replay protections.

## Transcript and artifact security

Controller turns and Vapi end-of-call messages are stored as canonical
`chat_messages`, linked to a same-tenant voice conversation whose session token
is `vapi_call:<callId>`.

- Only user and assistant text is accepted.
- Credential-shaped text is redacted and whitespace is normalized.
- Each message is limited to 4,000 characters.
- End-of-call ingestion is limited to 200 messages.
- Raw provider payloads and credentials are never stored.
- Raw call, video, and packet-capture recording remain disabled.
- Deterministic message IDs make controller retries and duplicate end-of-call
  reports idempotent.
- Parsing-only normalization feeds the controller, while the journal preserves
  the provider's original bounded utterance so end-of-call de-duplication is
  faithful.
- Every new controller/end-of-call row carries a 30-day
  `ai_metadata.retention_expires_at` deadline.
- Database access remains behind the existing `chat_messages` RLS/admin policy;
  service-role writes first prove the conversation and organization match.

This PR records the deletion deadline but does not install or run a production
purge job. Before enabling provider transcript delivery, the operator must
approve and verify a tenant-safe process that deletes rows after that deadline.
That operational retention activation is separate from this no-deploy PR.

The follow-on repository mechanism is specified in
`docs/voice/voice-artifact-retention-release.md` and migration
`20260802043233_voice_artifact_retention_purge.sql`. Neither merging that code
nor this document applies the migration or authorizes the scheduled purge.

## Vapi transcription decision

The version-controlled manifest selects Deepgram Nova-3 English with smart
formatting and Nova-3 `keyterm` hints. This best matches the incident risk:
proper names, local place names, service terms, spelled words, and numbers.

Deepgram Flux was evaluated. Its conversational endpointing and configurable
end-of-turn threshold are attractive for fast dialogue, but the repair favors
Nova-3 keyword biasing plus explicit application confirmation for names,
emails, phone numbers, and addresses. AssemblyAI Universal Streaming English
is the explicit fallback, with its documented keyterm prompt and VAD-assisted
endpointing. Vapi smart endpointing and separate punctuation,
non-punctuation, and number waits reduce premature turns without inventing STT
confidence fields.

The assistant manifest enables logging, full message history, transcript
artifacts, and `end-of-call-report`; it keeps recording, video, packet capture,
summary, structured-data analysis, and success analysis disabled. Dashboard
settings must be reconciled to this manifest during an explicitly authorized
configuration window.

## Sanitized timing contract

Structured telemetry records numeric durations for request arrival to stream
start, controller execution, quote-session persistence, projection, local
identity preparation, pricing, address/service-area validation, availability,
booking, and journal writes. It contains no transcript or contact values. STT
and TTS latency are not claimed; provider message timestamps are retained only
when Vapi supplies them.

## Controlled deployment and one-call verification

Do not perform these steps as part of this PR.

1. Merge only after exact-head CI, security review, and owner approval.
2. Approve and activate the 30-day expired-message purge procedure.
3. Deploy the changed shared dependencies together with
   `voice-llm-adapter` and `voice-vapi-events`; keep live booking disabled.
4. Reconcile the isolated Vapi assistant to the reviewed manifest. Confirm
   Nova-3 primary, AssemblyAI fallback, exact endpointing, exact keyterms,
   transcript/full-message/end-of-call delivery enabled, and all raw recording
   disabled.
5. Verify secrets and trusted assistant/hostname mappings by presence only.
6. Run provider-stub and read-only health checks before any call.
7. Obtain explicit authorization for one controlled paid call using a
   synthetic customer/contact record in the approved service area.
8. During the call, quote one supported service, spell one address component,
   correct one name component, confirm email/phone/address, request the quote
   by text, and ask for availability. Do not enable live booking.
9. Verify one quote session, one tenant conversation projection, one local
   customer/property/link set, one copy of each turn, one signed quote, one SMS
   attempt, preserved readiness blockers, and sanitized timing only.
10. Replay the same end-of-call report in a controlled stub or approved
    non-provider harness and verify zero duplicate transcript rows.
11. Stop on organization mismatch, repeated question, stale quote, ambiguous
    identity, missing projection, unexpected provider action, raw payload in a
    log, or false success language.

Rollback is to restore the prior Edge bundles and restore the prior assistant
manifest while leaving live booking disabled. Do not delete customer records or
messages as part of code rollback; review any controlled-test records through
the approved tenant-data procedure.
