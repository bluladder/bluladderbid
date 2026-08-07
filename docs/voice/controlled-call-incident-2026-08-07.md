# Controlled voice-call incident — 2026-08-07

## Scope and production evidence

- Deployed source at the time of the call: `9f01db3666c69103b11caae541364d1e2b07830a`.
- Edge build marker: `voice-adapter-4C-b.6.9-deferred-sse`.
- Redacted provider call suffix: `…0a68`.
- The caller received the authoritative price. No booking, quote text, SMS, or
  other customer/provider mutation was attempted.
- The provider ended the call as `customer-ended-call`. Booking remained in
  dry-run mode.

No raw phone number, address, transcript, provider credential, or customer PII
is recorded in this incident note.

## Observed sequence

The first two controller turns completed in 8,721 ms and 5,730 ms. The third
turn completed its deterministic controller work and canonical journal write in
5,905 ms, but the response connection closed before the message completed.
Two subsequent requests arrived for the same provider turn. The single-flight
guard correctly prevented the controller and external actions from running a
second time, but the duplicate path returned silence because it had no bounded
way to resume the already-completed answer.

The post-price utterance did not contain a recognized text-delivery or
scheduling cue in the bounded classifier input, so it did not authorize quote
delivery. This is consistent with a transcription paraphrase or ambiguous
answer; the exact raw transcript is intentionally not copied here.

## Repair acceptance cases

1. A completed exact-turn retry may replay only the canonical assistant row
   whose organization, conversation/session, turn ID, turn position, content
   hash, and deterministic journal identity all match.
2. Replay rechecks single-flight authority immediately before responding and
   cannot rerun the controller, pricing, booking, quote delivery, or another
   external action.
3. Missing, ambiguous, stale, cross-tenant, or mismatched journal evidence
   remains silent and fail-closed, with a non-PII reason code in Edge logs.
4. The streaming response exposes its role frame without an asynchronous
   `ReadableStream.start()` barrier. A slow authoritative turn retains the one
   neutral bounded acknowledgement before canonical speech.
5. The known acknowledgement/flush prefix is removed from assistant artifacts
   before canonical deduplication; user content is not rewritten.
6. An ambiguous answer after a firm price receives a distinct question:
   whether to text the written quote or check appointment times. Generic assent
   alone authorizes neither branch.
7. Provider interruption thresholds require two words and 0.4 seconds of
   caller audio, reducing accidental interruption from incidental sound. The
   custom-model timeout is explicitly bounded at 20 seconds.

## Measurements and release boundary

Repository tests can prove deterministic replay identity, no repeated action,
stream framing, exact provider reconciliation, artifact normalization, and
fail-closed ambiguity. Only a controlled production call after merge, Edge
deployment, and exact Vapi snapshot verification can measure perceived speech
latency and confirm that the provider renders the acknowledgement and resumed
answer.

This change does not alter pricing, migrations, the protected single-flight
SQL, tenant authority, booking mode, phone binding, credentials, or production
data. Keep the existing number, assistant binding, and Edge deployment
connected while the draft PR is reviewed. Do not patch Vapi or deploy the new
Edge bundle until the exact-head checks pass and the owner approves that
production sequence.

Rollback is source-forward: restore the prior provider interruption/timeout
manifest values in a reviewed commit if necessary, redeploy the last known-good
`voice-llm-adapter` bundle from `9f01db3…`, and reconcile Vapi to its previously
verified snapshot. Do not roll back the single-flight database contract or
rewrite published history.
