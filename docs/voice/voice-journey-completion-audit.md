# Voice Journey Completion Audit

Status: implementation baseline audit
Audited revision: `4e1cafa78166a510b216cb063537fbe094c83f24`
Audit date: 2026-08-01
Scope: customer-facing inbound voice journey only; no provider or production calls were made.

## Executive finding

PR #62 established a credible canonical quote contract, and PR #60 preserved useful transcript normalization, but the live voice path still has two competing authorities:

1. `quote_sessions.fields` contains the complete, service-specific intake contract, provenance, quote result, duration, and readiness state.
2. `chat_conversations.facts` contains an older residential subset and still drives most active voice pricing, delivery, availability, and booking sequencing.

That split is the root cause behind stale quotes surviving corrections, canonical service fields disappearing at the voice boundary, provider results being collapsed into optimistic booleans, and the deterministic controller delegating its important actions back to the legacy model-directed orchestrator.

The safe completion path is incremental. Keep the existing provider adapters, outboxes, booking ledgers, identity gates, service-area validator, and canonical contract. Make the quote session the sticky journey context, route pricing through one complete adapter, preserve provider outcome states, and give the deterministic controller explicit typed actions. No rewrite or database migration is required for this tranche because `quote_sessions.fields` and `chat_conversations.facts` are existing JSONB extension points.

## Current source-of-truth map

| Concern | Current authority | Competing or incomplete path | Consequence |
|---|---|---|---|
| Service requirements and policy | `salesEngine/quoteIntakeContract.ts` | legacy manifests and tool schemas | A channel can omit a required service field or ask an irrelevant one. |
| Progressive facts and provenance | `quoteSession.ts` / `quote_sessions` | `conversationState.ts` / `chat_conversations.facts` | Voice corrections do not reliably invalidate every downstream artifact. |
| Pricing math | mirrored `pricingEngine.ts` files | three handwritten session-to-engine adapters | Canonical math is shared, but the inputs reaching it are not. |
| Price disposition | pricing result plus canonical intake evaluation | legacy `firm` boolean | Mathematical firmness can bypass product-policy/manual-review gates. |
| Duration | `durationContract.ts` and pricing result | legacy nullable duration handling | Strong booking readiness exists, but legacy voice can still reason from partial state. |
| Delivery persistence | `quoteDelivery.ts`, `smsOutbox.ts`, `queueDelivery.ts` | `voice/quoteByTextDelivery.ts` nested Edge calls and boolean response | Accepted, retryable, uncertain, and terminal outcomes lose customer-safe wording. |
| Identity | `identityAnchor.ts` | quote-session lookup by phone/email before identity proof | A session can be linked more broadly than an identity-sensitive action permits. |
| Service area | `serviceArea.ts` plus voice confirmation gate | whole-address re-ask flow | One bad component can cause a full-address loop. |
| Availability | `bookingReadiness.ts`, `availabilityLookup.ts`, Jobber mirror | legacy `aiTools.ts` availability path | Two paths enforce different readiness and freshness rules. |
| Booking | `voiceBookingAdapter.ts`, booking ledger and Jobber recovery | legacy model tool sequencing | The provider boundary is strong, but the controller is not the sole invoker. |
| Existing quotes/bookings | secure portal/resume and customer-scoped queries | no complete voice workflow | Existing-customer intents are handed off instead of safely continued. |
| Reschedule/cancel | `customer-appointment-actions`, cancellation helpers | controller handoff | Existing fail-closed provider behavior is not exposed through a verified voice contract. |

## Evidence-backed defects

### 1. The price-input fingerprint is incomplete

`conversationState.quoteInputsKey` includes only services, address, square footage, stories, legacy window type, condition, screen profile, roof, driveway, one pressure-wash measurement, discount, and promotion. It omits solar-panel count, screen-repair count, named flatwork areas, gutter add-ons, house-wash patios, window modifiers, enclosure details, access profiles, provenance, and recap confirmation.

`quoteSession.sessionInputsKey` constructs many of those values but then casts them into `ConversationFacts.property`; the downstream `quoteInputsKey` ignores them. A customer can therefore correct a price-changing canonical fact while a cached quote, slot offer, or booking-readiness decision still appears current.

### 2. Canonical fields are lost at the voice boundary

`QuoteSessionFields` models the PR #62 matrix. `ConversationFacts.property`, `fieldsFromFacts`, and `factPatchFromTool` model only a subset. Synchronizing from legacy facts cannot preserve complete service state, and the active voice tool schema cannot capture several canonical services or modifiers.

### 3. Pricing adapters compete and diverge

`workflowController.sessionToQuoteInput`, `draftTools.fieldsToQuoteInput`, and `aiTools.buildQuoteRequest` each map intake to the engine. The controller omits most services. The draft adapter defaults stories to one, driveway surface to concrete, converts pressure washing into a back-patio shortcut, and omits new PR #62 additions. `aiTools` is more complete but still flattens named pressure-washing areas and restricts the service allowlist. These adapters can produce different totals from the same quote session.

### 4. The deterministic controller is not authoritative

`workflowController.runControllerTurn` owns caller-ID confirmation and returning-customer greeting only. Pricing, delivery, availability, booking, cancellation, rescheduling, questions, and memo intents return `delegate_legacy` or handoff. `voice-llm-adapter` then runs `aiOrchestrator`, whose model tool calls remain the effective workflow authority.

### 5. Corrections do not invalidate the complete journey

`quoteSession.mergeFields` tracks captured/corrected/derived/defaulted provenance but does not clear `lastQuoteResult`, quote status, booking readiness, accepted quote context, delivery continuation, availability, or selected slot. `conversationState.mergeFacts` clears only availability and the selected slot when its incomplete key changes. A correction can leave stale customer language and continuation state.

### 6. Delivery truth is implemented below an incomplete voice contract

`quoteDelivery.ts` and `smsOutbox.ts` distinguish provider submission, accepted, retryable failure, terminal failure, and uncertain outcome with idempotent claims. `quoteByTextDelivery.ts` instead calls `save-quote` and `send-sms` as nested Edge functions and returns `{ok, reason}`. `quoteByText.ts` can say “I've texted” only after `ok`, which is better than optimism, but it cannot accurately distinguish queued/retryable/uncertain states or email delivery.

### 7. Address recovery is house-number aware but not component aware

The voice gate confirms the full geocoded address and has strong digit-by-digit house-number correction. If city, ZIP, state, street name, or unit is incomplete/mismatched, the continuation asks for the entire address again. It does not retain verified components and request only the missing or disputed part.

### 8. Authoritative availability exists beside a legacy path

`bookingReadiness.ts` correctly re-resolves identity, property ownership, canonical requirements, input fingerprints, duration, manual review, price versions, and schedule freshness. `availabilityLookup.ts` uses that result, but its default Jobber call is a nested Edge invocation without an explicit timeout and collapses provider/timeout/stale/sync states. `aiTools.availabilityTool` is a separate, less complete path.

### 9. Provider recovery primitives are strong but disconnected

Booking uses offer versions, expirations, quote signatures, idempotency, and Jobber reconciliation. Cancellation fails closed and recognizes idempotent “already gone” results. Secure quote resume and customer portal DTOs exist. The voice controller does not bind these primitives into verified existing-quote, continuation, reschedule, cancellation, or memo workflows.

### 10. Existing quote compatibility code contains unsafe inferred defaults

`quote-resume/index.ts` reconstructs older `additionalServices` with hard-coded driveway/pressure-wash quantities and concrete surfaces. That hydration is a browser compatibility fallback, not verified canonical intake, and must never be promoted into voice-confirmed pricing facts.

## Security and tenant boundary review

- Quote sessions are backend-only with RLS enabled; authenticated access is admin-read-only. This is an appropriate extension point.
- `identityAnchor.ts` is fail-closed and accepts only confirmed email, exact phone, or verified account signals. Customer-scoped voice reads and writes should use it before exposing any stored fact.
- Service-role keys remain server-side. No proposed voice DTO may expose service keys, raw provider errors, customer collections, or unscoped row data.
- Issue #7 requires organization resolution to remain server-derived. This tranche must not add client/model-supplied `organization_id`, tenant migrations, cross-tenant fallbacks, or a second org-selection mechanism.
- Existing customer actions have stricter portal/admin authentication assumptions than an inbound call. Voice cannot call those endpoints by pretending to be a portal user; it needs a narrow server-side adapter that first resolves the canonical identity and booking ownership, then delegates to the existing fail-closed provider helpers.

## Current Supabase runtime review

Official Supabase documentation and changelog were reviewed on 2026-08-01:

- [Edge Functions runtime limits](https://supabase.com/docs/guides/functions/limits)
- [Recursive and nested function-call limits](https://supabase.com/docs/guides/functions/recursive-functions)
- [Edge worker timeout and background-work behavior](https://supabase.com/docs/guides/troubleshooting/edge-functions-worker-timeouts-and-websocket-drops)
- [Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Service-role and data security](https://supabase.com/docs/guides/database/secure-data)

- Hosted Edge regions support Deno 2.1 compatibility; Deno 1.45 fallback remains available for compatibility.
- Edge Functions have finite CPU, memory, wall-clock, idle, and log limits. Long provider operations must use explicit timeouts and bounded work.
- `EdgeRuntime.waitUntil` keeps background work within the same worker limits; it is not durable delivery. Durable retries belong in persisted queues/outboxes.
- Supabase now rate-limits nested Edge-to-Edge function chains. Shared libraries or queues are preferred over chaining functions for workflow steps.
- Service-role clients bypass RLS and must remain narrowly contained. Customer-context clients should use the caller's authenticated context when RLS is the intended authorization boundary.

Implementation consequence: replace new nested voice-function orchestration with shared modules and existing durable queues. Preserve current functions for compatibility, but do not add another nested chain.

## Provider outcome taxonomy required by the voice controller

Every external action must return a typed state. Customer language may claim completion only for a terminal confirmed state.

| Action | Confirmed | Pending/retryable | Uncertain | Terminal failure |
|---|---|---|---|---|
| SMS/email delivery | provider accepted with durable message/attempt id | queued or retry scheduled | provider outcome unknown | validation or permanent provider rejection |
| Availability | fresh authoritative slots with offer/version/expiry | schedule refresh or provider retry in progress | provider response cannot be trusted | identity/property/quote/duration/policy blocker |
| Booking | local ledger and Jobber creation reconciled/confirmed | retry/reconciliation pending | external outcome unknown; hold preserved | rejected/expired/taken/invalid without booking |
| Reschedule/cancel | Jobber mutation positively confirmed or idempotently already applied | safe retry pending | provider result unknown; do not claim change | authorization/window/provider failure |

## Implementation boundary

This branch will:

- make the canonical quote-session fingerprint complete and invalidate stale dependent state;
- establish one quote-session-to-pricing adapter and use it from controller/draft paths;
- add a sticky, typed voice journey context stored in existing JSONB;
- add component-aware address recovery;
- preserve delivery and provider outcomes in typed voice-safe language;
- add verified existing-record workflow planning and guarded appointment-action adapters;
- move controller intent, question selection, action eligibility, and customer assertions into deterministic functions;
- retain the PR #60 input normalizer ahead of every route;
- add scenario and regression coverage without live provider calls.

It will not:

- change pricing formulas, durations, service-area policy, or canonical questions;
- add a migration or collide with the tenant architecture work;
- deploy, send messages, create appointments, invoke Jobber, or change provider configuration;
- implement provider-specific prompt configuration or a new Voice AI platform controller.

## Verification targets

1. Canonical and Edge mirrors are byte-identical.
2. Every price-affecting correction changes the canonical input key and clears dependent readiness.
3. Defaulted values remain distinct from captured/verified values.
4. One canonical adapter covers the full service matrix with no implicit surfaces, stories, counts, or areas.
5. Voice delivery never says sent/emailed unless the durable provider state permits it.
6. Address recovery asks only for the missing/disputed component when possible.
7. Availability and booking require identity, property, quote, price version, duration, service area, offer version, and freshness.
8. Existing records are never revealed or mutated before deterministic identity and ownership checks.
9. Controller and legacy-parity tests prove canonical state is not lost at the route boundary.
10. The transcript-derived voice normalization tests remain green.
