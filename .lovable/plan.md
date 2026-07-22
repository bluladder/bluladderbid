# Canonical Progressive Quote Session (Phase 4C-β.4)

Move from per-channel conversation state to a single **Quote Session** object that voice, web, SMS, and future channels all edit incrementally. The conversation becomes a thin natural-language interface; the Quote Session is the source of truth.

No CallRail/transfer/booking/campaign changes in this phase. Booking dry-run stays on for voice.

## Architecture at a glance

```text
   ┌──────────┐  ┌────────┐  ┌──────┐  ┌───────┐
   │  Voice   │  │  Web   │  │ SMS  │  │ Chat  │   channels
   └────┬─────┘  └───┬────┘  └──┬───┘  └───┬───┘
        │           │          │          │
        └────────── fact patches ─────────┘
                        │
                ┌───────▼────────┐
                │ QuoteSession   │  (canonical, versioned)
                │  fields+status │
                └───────┬────────┘
                        │
        ┌───────────────┼────────────────┐
        │               │                │
   Pricing engine   Booking path    Resume link
   (unchanged)      (unchanged)     (existing tokens)
```

Voice/web/SMS orchestrators keep their prompts and tools but delegate all fact reads/writes to a shared `quoteSession` module. `ConversationFacts` becomes a view over the session.

## Quote Session schema

New table `public.quote_sessions` (progressive intake state, distinct from the finalized `quotes` row):

- `id uuid pk`
- `channel text` (voice|web|sms|chat) — initiating channel
- `conversation_ids text[]` — one session may span chat_conversations rows across channels
- `customer_id uuid nullable` — set once identified/created
- `quote_id uuid nullable` — set once a canonical quote is persisted
- `fields jsonb` — canonical field bag (see below)
- `field_status jsonb` — per-field `unknown|captured|verified|corrected|derived`
- `required_remaining text[]` — computed
- `last_step text` — last completed planner step
- `quote_status text` — none|estimated|firm|manual_review|error
- `booking_ready boolean`
- `resume_token_id uuid nullable` — reuses existing `quote_resume_tokens`
- `expires_at timestamptz`
- `created_at`, `updated_at`

`fields` keys (reuse existing canonical shapes; no duplicate models):
- contact: `name`, `email`, `phone`
- location: `address`, `city`, `state`, `zip`, `lat`, `lng`
- service: `services[]`, `windowCleaningType`, `serviceOptions`
- property: `squareFootage`, `stories`, `condition`, `roofType`, `roofSeverity`, driveway/PW fields
- pricing: `promotionId`, `discountCode`, `modifiers`
- quote: mirrors current `ConversationFacts.quote` (total, lineItems, inputsKey, engineVersion)

RLS: service-role write; customer read via existing resume-token grant path. GRANTs included in the migration.

## Progressive persistence

- Every orchestrator turn produces a **fact patch**. Patches are applied through `quoteSession.applyPatch(sessionId, patch, source)` which:
  1. Merges into `fields`, updates `field_status` (unknown→captured; changed→corrected).
  2. Recomputes `required_remaining` from the pricing engine's declared input needs for the selected services.
  3. Invalidates dependent state (quote/availability/slot) on correction, matching `mergeFacts` rules.
  4. Auto-invokes `calculate_bluladder_quote` when all required pricing inputs are present and no current quote matches the inputs key.
  5. Persists atomically; returns the updated session.
- Voice rough-quote rail, web `runOrchestrator`, and SMS orchestrator all call this instead of writing to `chat_conversations.facts` directly. `chat_conversations` keeps a `quote_session_id` pointer.

## Conversation planning

New `quoteSession.nextQuestion(session)` returns:
- `readyToPrice: boolean`
- `readyToBook: boolean`
- `missing: string[]`
- `nextField: string | null` — the single best next question, chosen from `required_remaining` in a channel-agnostic priority order (service → property essentials → address if booking → contact if booking).

Orchestrators use this instead of hard-coded scripts. Interruptions (unrelated questions) leave the session untouched; the planner still returns the same `nextField` on resume. Corrections update one field and only invalidate what depends on it.

## Cross-channel continuity

- `chat_conversations.quote_session_id` links every channel row to the same session.
- Voice `ensureVoiceConversation` and web/SMS entry points call `quoteSession.findOrCreate({ phone, email, channel })` — matches on verified phone/email first, otherwise creates.
- Resume token minting is unchanged; token now references `quote_session_id` in addition to `quote_id` when a finalized quote exists.

## Dropped-call recovery

On voice call end (existing Vapi end-of-call hook / session close in `voiceAdapter`), if the session has enough facts to price and SMS consent exists, mint a resume URL via existing `mintResumeUrl` and send through the existing SMS path. No new messaging surface. No auto-send without consent.

## Files to change

Shared modules (edge):
- `supabase/functions/_shared/quoteSession.ts` — NEW. Types, `findOrCreate`, `applyPatch`, `nextQuestion`, `computeRequired`, `invalidateDependents`.
- `supabase/functions/_shared/conversationState.ts` — keep state names; `ConversationFacts` derived from session fields; `mergeFacts` delegates to `quoteSession.applyPatch` invalidation rules.
- `supabase/functions/_shared/aiOrchestrator.ts` — route persistence through quoteSession; planner uses `nextQuestion`.
- `supabase/functions/_shared/voiceAdapter.ts` — `ensureVoiceConversation` attaches/creates `quote_session_id`; end-of-call dropped-call helper.
- `supabase/functions/_shared/smsOrchestrator.ts` — read/write via quoteSession keyed by phone.
- `supabase/functions/_shared/buildMarker.ts` — bump `BUILD_ID` to `voice-adapter-4C-b.4-progressive-quote-session`; keep existing flags; add `progressiveQuoteSession: true`.

DB:
- New migration: `quote_sessions` table + GRANTs + RLS + trigger for `updated_at`; add `quote_session_id uuid` nullable to `chat_conversations`.

Frontend: unchanged behavior. `useServerQuoteCalculation` and the web BookingFlow already POST canonical inputs; server-side maps the request to a quoteSession patch. No UI redesign in this phase.

## Tests

Deno (shared functions):
- `quoteSession_test.ts` — patch merge, status transitions, correction invalidation, `nextQuestion` ordering, cross-channel `findOrCreate`, auto-price trigger, dropped-call resume payload.
- `voiceAdapter_test.ts` — voice turn produces a session, second turn does not re-ask captured fields, correction updates one field, drop → resume link path (mocked SMS send).
- `smsOrchestrator_test.ts` — SMS turn edits an existing voice session by phone.
- `aiOrchestrator_test.ts` — web path unchanged output; planner picks next best question.

Vitest (frontend regression):
- Existing engine parity, plan booking, promotion, and booking flow tests must remain green.
- Add a small integration test that the web booking payload still round-trips through the server as a session patch and returns identical pricing (parity assertion against `engine.ts`).

## Deployment

1. Run migration (adds `quote_sessions`, `chat_conversations.quote_session_id`).
2. `tsgo` typecheck, `deno test` shared suite, `vitest run` frontend suite.
3. Deploy edge functions: `voice-llm-adapter`, `ai-chat`, `send-sms`, `campaign-event`, `save-quote` (any function that reads/writes conversation facts).
4. Verify `/voice-llm-adapter/diagnostics` shows the new BUILD_ID and `progressiveQuoteSession: true`.
5. No auto browser call.

## Explicit non-goals / guardrails

- No pricing values, formulas, minimums, or modifiers change.
- No phone numbers created; no CallRail routing edits; no transfer configuration.
- No production booking from voice (dry-run stays on).
- No outbound campaigns activated or sent.
- No duplicate customer or quote models — reuse `customers`, `quotes`, `quote_resume_tokens`, canonical pricing engine.

## Technical details

- `field_status` transitions: unknown → captured on first non-empty value; captured → corrected when value changes; captured → verified when a validator (address geocode, service-area check, OTP) confirms; derived for engine-computed fields (e.g., pricing modifiers).
- `required_remaining` is computed from a per-service manifest that mirrors the pricing engine's declared required inputs — no new pricing rules, just introspection of existing engine input shape.
- Concurrency: session updates use optimistic `updated_at` check; conflicting patches merge field-by-field with last-writer-wins per field and a corrected-status marker.
- `chat_conversations` remains for transcript/history; only the pointer column is added.

## Deliverable / status at end

Final report will include: architecture changes, schema diff, file list, planner behavior, progressive persistence proof, cross-channel proof, typecheck/Deno/Vitest results, deployment result, new build marker, and either **READY FOR PROGRESSIVE QUOTE TEST** or **NOT READY** with the exact blocker.
