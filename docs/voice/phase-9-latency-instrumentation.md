# Phase 9 voice latency instrumentation

## Scope and safety

Phase 9 adds measurement code only. `VOICE_LATENCY_METRICS` remains disabled by
default, and this change does not deploy an Edge Function or alter a provider,
feature flag, pricing rate, migration, or production record.

Each accepted authoritative turn derives one opaque correlation UUID from the
server-derived turn identity. The telemetry schema accepts only allow-listed
route/outcome labels and numeric timing values. It does not accept or emit raw
call or turn identifiers, phone numbers, names, email addresses, service
addresses, transcripts, message content, provider credentials, or secrets.

## Measured boundaries

The `voice-turn-latency-v1` event records monotonic offsets for:

- provider HTTP event receipt;
- parsed final-user-turn receipt;
- successful single-flight claim;
- authoritative conversation/session load;
- deterministic controller completion;
- persistence completion;
- the first actual response chunk enqueue (or JSON response construction);
- completed response/stream.

Duration buckets keep the major sources separate:

- provider/transcription delay, only when an allow-listed provider timestamp is
  present and within a bounded ten-minute window;
- single-flight database claim;
- conversation/session database load;
- total database time;
- deterministic controller processing;
- canonical pricing;
- address and identity checks;
- external tool/provider work;
- persistence, projection, and journal work;
- application time to first chunk and total application time.

Missing provider timestamps remain `null`; the application does not infer or
invent provider/transcription delay.

## Repository-measurable evidence

Deterministic repository tests prove:

- replayed turn identities produce the same opaque correlation UUID and a new
  authoritative turn produces a different UUID;
- fixed monotonic clocks produce exact milestone and duration buckets;
- unrecognized, future, or implausibly old provider timestamps fail closed to
  an unmeasured provider delay;
- the event schema contains no PII/transcript/provider-identifier fields;
- metrics stay flag-gated and telemetry failures cannot affect a response;
- the first-chunk marker executes immediately before the first SSE enqueue and
  completion executes after stream close;
- one canonical pricing snapshot is reused for readiness and calculation;
- the quote-session snapshot already loaded for projection is reused instead
  of issuing an immediate duplicate read.

Repository timings are deterministic boundary tests, not production latency
benchmarks. They do not prove PSTN, Vapi, transcription, regional network,
Supabase, downstream provider, text-to-speech, or caller-device performance.

## Controlled-production-call evidence still required

After the PR is merged, the protected single-flight SQL is reviewed and
applied, affected Edge bundles are deployed, provider configuration is
reconciled, and safety flags are confirmed, one separately authorized
controlled call must capture a redacted `voice-turn-latency-v1` event. The
operator should verify:

1. exactly one correlation UUID is used for the turn;
2. first response chunk precedes response completion;
3. provider delay is either a bounded measurement or explicitly `null`;
4. pricing, database, address/identity, external-tool, and persistence buckets
   are non-negative and match the turn path;
5. no phone, address, transcript, customer detail, provider id, or credential
   appears in logs;
6. streaming and interruption remain behaviorally correct.

No latency target or success claim should be recorded until that controlled
call provides measurable evidence.
