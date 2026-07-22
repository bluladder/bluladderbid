
# Phase 4C — Call-Center Workflow Router v1

Scope-limited to the single launch workflow: **Residential window-cleaning quote → canonical price → real availability → booking**. Every other workflow (`cancel_or_reschedule`, `general_inquiry`, commercial bid, etc.) is stubbed as `handoff_or_out_of_scope` so the architecture can grow without a rewrite.

## Guiding rules

- Reuse everything sound. Do not rebuild the pricing engine, availability mirror, Jobber client, booking handler, customer/property model, SMS/email, auth, or reservation guards.
- LLM produces natural-language wording only. All sequencing, field-completion, tool selection, and terminal actions are deterministic code.
- One canonical `quote_sessions` row per call. Reloaded from DB **before every next-action decision**. No re-parsing of transcript for state.
- No pricing values change. No CallRail/Vapi provisioning changes. No transfer changes. Voice booking stays in dry-run.

## Repository reuse audit (draft — will be finalized in the completion report)

- **Preserve unchanged:** `pricingEngine.ts`, `quoteSession.ts` schema + persistence helpers, `jobberClient.ts`, `availability_cache` + `useSmartAvailability`, `aiTools.ts` tool contracts, `authoritativeQuote.ts`, `bookingPreparation.ts`, `phoneConfig.ts`, `emailConfig.ts`, `serviceArea.ts`.
- **Adapt (thin edits):** `voiceAdapter.ts` (route through new controller), `conversationState.ts` (repurpose as data source, not sequencer), `windowIntent.ts` (used by extractor only), `buildMarker.ts` (new id + flags).
- **Replace as authoritative sequencer:** the prompt-directive path inside `aiOrchestrator.ts`. The orchestrator stays as an LLM-wording utility; sequencing moves to the new controller.

## New modules

```text
supabase/functions/_shared/
  workflow/
    workflowRouter.ts        # classifies inbound intent → workflow id
    workflowSession.ts       # thin wrapper over quote_sessions with reload-before-decide
    factExtractor.ts         # LLM-assisted structured extraction (JSON only, no wording)
    customerResolver.ts      # find-or-create customer + property, immutable ids
    workflows/
      residentialQuote.ts    # deterministic FSM: intake → price → availability → book
      handoffPlaceholder.ts  # every other workflow, safely escalates
    intakeSchemas.ts         # required-field manifests per workflow branch
    speak.ts                 # LLM wording utility (never chooses next action)
    workflowController.ts    # single entry: next(action) + apply(customerUtterance)
  workflow_test/             # unit tests for controller + resolver + extractor
```

Voice adapter change: `runVoiceAdapterStream` calls `workflowController.turn({...})` instead of `runOrchestrator` for supported workflows. Unsupported flows fall back to today's orchestrator so we do not regress existing web/SMS behavior.

## Deterministic residential-quote FSM

States (owned by `workflows/residentialQuote.ts`):

```text
identify_service → confirm_scope → collect_sqft → collect_sides → collect_stories
  → (optional) collect_city_for_serviceability
  → calculate_price → speak_price
  → offer_scheduling → collect_address → fetch_availability → offer_slots
  → confirm_slot → dry_run_book (voice) | real_book (web/sms) → confirm_result
```

Rules:
- `nextAction()` returns one typed action; controller executes it, persists, reloads, and only then asks LLM for wording.
- `hasUsableFact(field, session)` gates every ask. Normalized equivalents (`outside only`/`exterior only`/`just outsides` → `outside_only`) resolve before the check.
- City is **not** on the pricing critical path. Serviceability runs `Promise.race` with a 400 ms budget; on miss it defers to before-booking and the controller advances to price immediately.
- Pricing invocation is automatic the instant the required-field manifest is satisfied. Result is persisted; state advances to `speak_price` without an intervening LLM turn.
- Corrections update only affected fields; downstream cached quote/availability are invalidated by version bump.
- Interruptions (insurance, hours, service area questions) route to `speak.answer(question)` then re-enter `nextAction()` from the reloaded session — progress is never lost.

## Customer Resolver

- Input: any of `{ phone, email, name, address }` captured so far.
- Match order: phone (E.164 hash) → email hash → address canonical hash. All matches must be exact; ambiguous matches escalate rather than merge.
- Idempotent: repeated calls in the same session return the same `customer_id` + `property_id`.
- No mutation until the caller confirms; only reads until `resolveAndCommit()` is invoked before booking.

## Voice pipeline

- Adapter is unchanged for auth/CORS/streaming.
- New: fast acknowledgement token stream (< 300 ms) while controller runs, so there is no silent gap.
- Any operation > 3 s: emit a filler acknowledgement and continue with the next non-blocking step.
- Latency instrumentation: extractor, persist, reload, controller, price, availability, total.

## Tests

Local Deno unit tests:
- `workflowRouter.test.ts` — intent classification (new_quote, schedule_service, cancel_or_reschedule, general_inquiry, out_of_scope).
- `residentialQuote.fsm.test.ts` — every transition, correction, interruption, duplicate-prevention.
- `customerResolver.test.ts` — new customer, existing by phone, existing by email, address match, ambiguous → escalate.
- `hasUsableFact.test.ts` — normalization + never-repeat.

Integration harness (drives the **real** deployed-shape code, not mocks of the failing layer):
- `residentialQuoteToBooking.integration.test.ts` — 6-turn script from the failure spec, plus interruption + correction + duplicate-prevention. Uses a real Supabase test schema and a stub Jobber client that records but does not call.

Deployed synthetic (executed by me since the shared secret is available):
- Authenticated multi-request POST sequence against `voice-llm-adapter` using one stable `x-bluladder-session-id`. Asserts one `quote_sessions` row, no repeated question, canonical price spoken, dry-run booking recorded.

## Deployment sequence

1. Typecheck (`tsgo`).
2. Full Deno test suite.
3. Vitest suite.
4. Pricing parity tests (`engine.parity`, `engine.bundleParity`).
5. Integration harness.
6. Deploy: `voice-llm-adapter`, `ai-chat` (kept in sync for shared code), plus any function importing the new modules.
7. Deployed synthetic workflow test.
8. Update `BUILD_ID` = `voice-adapter-4C-call-center-workflow-v1`.
9. Flags: `deterministicWorkflowRouter`, `customerResolver`, `quoteToBookingWorkflow`, `canonicalPricing`, `deployedMultiTurnWorkflowTest`, `voiceBookingDryRun` — all `true`.

## Explicit non-goals for this phase

- No new pricing values or formulas.
- No commercial pricing, no partial-window wording changes beyond what already ships.
- No CallRail routing, provisioning, or transfer configuration changes.
- No production booking. Voice remains dry-run.
- No new SMS sends. No call to Ben's cell.
- Existing web chat and SMS orchestration paths remain intact; only voice is switched to the new controller in this phase. Web/SMS migration to the controller is a follow-up phase, gated on this one's synthetic pass.

## What the completion report will contain

The 34-item report specified in your message, with concrete evidence for each item (file diffs, test output, deployed synthetic transcript with PII scrubbed, latency numbers, pricing-parity diff, build marker verified via `/diagnostics`).

## Execution plan across turns

1. **Turn A (forensics + skeleton):** sanitized root-cause report for `019f8a84-…` from our side; scaffold `workflow/` modules with types + tests but no behavior wired in.
2. **Turn B (controller + resolver):** implement `residentialQuote.ts`, `customerResolver.ts`, `factExtractor.ts`, `hasUsableFact`, unit tests green.
3. **Turn C (adapter wiring + integration harness):** switch `voiceAdapter` to controller for supported workflows; integration harness passes locally.
4. **Turn D (deploy + synthetic):** deploy, run deployed multi-request synthetic, produce the full completion report and READY / NOT READY status.

Approve this scope and I'll start with Turn A.
