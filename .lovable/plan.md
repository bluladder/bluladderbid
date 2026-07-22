# Sales Engine Consolidation Plan — Step-to-Module Map

Goal: one Sales Engine, consumed by voice / web / future chat / future SMS, with zero duplicated business rules. Below, each numbered step from the objective maps to authoritative modules, missing capabilities, and duplicates slated for retirement.

## 1. Determine requested service(s)

- **Authoritative:** `src/components/homeowner/IntentFirstServiceSelector.tsx` (canonical service catalog + intent labels) and `src/lib/pricing/engine.ts` service keys.
- **Missing:** A headless service-intent resolver usable outside React. Extract a shared `resolveServiceIntent(input)` helper in `src/lib/pricing/` (or `_shared/services/`) that both the web selector and the voice `factExtractor` call.
- **Retire eventually:** `supabase/functions/_shared/workflow/windowIntent.ts` classification logic — collapse into the shared resolver.

## 2. Collect only required info for an authoritative quote

- **Authoritative:** `src/lib/pricing/engine.ts` (defines required inputs per service) + `calculate-quote` edge function (server-side re-validation) + `src/components/booking/BookingStepper.tsx` / `HomeDetailsForm.tsx` (canonical question ordering).
- **Missing:** A machine-readable `SERVICE_INTAKE_MANIFEST` derived from the pricing engine — one exported map `{ service → required fields, in ask-order }`. Voice reads this instead of maintaining its own list.
- **Retire eventually:** `supabase/functions/_shared/workflow/intakeSchemas.ts` and the parallel readiness logic inside `quoteSession.ts`.

## 3. Generate the quote via canonical engine

- **Authoritative:** `supabase/functions/calculate-quote` (HTTP boundary) wrapping `_shared/pricingEngine.ts` (which mirrors `src/lib/pricing/engine.ts`).
- **Missing:** Nothing structural. Voice controller must call `calculate-quote` directly rather than reconstructing prices.
- **Retire eventually:** `supabase/functions/_shared/workflow/partialWindowPricing.ts` ($10/side rule) — move into `_shared/pricingEngine.ts` as a first-class partial-window branch so no channel invents pricing.

## 4. Evaluate one complementary service (auto)

- **Authoritative:** `src/hooks/usePricingConfig.ts` + engine's bundle definitions in `src/lib/pricing/engine.ts` (already knows Window ↔ House Wash pairing via bundle tests in `engine.bundleParity.test.ts`).
- **Missing:** A pure `suggestComplementaryService(quoteInput, quoteResult)` helper in `src/lib/pricing/` that returns `{ service, addlInputsRequired: [] }`. Returns nothing if additional questions are required. Currently the pairing logic is implicit in UI upsell components (`PlanUpsellCard.tsx`, `CompleteYourRefresh.tsx`).
- **Retire eventually:** Duplicated upsell selection heuristics inside `PlanUpsellCard.tsx` and `CompleteYourRefresh.tsx` — both should call the shared suggester.

## 5. Auto-price the complementary service + approved bundle promo (single offer)

- **Authoritative:** `_shared/pricingEngine.ts` (bundle math already exists; validated by `engine.bundleParity.test.ts`) + admin-managed promotion config consumed by `calculate-quote` (`input.promotion`).
- **Missing:** A `buildComplementaryOffer(session)` orchestration function that: (a) runs the suggester from step 4, (b) calls `calculate-quote` a second time with both services + eligible bundle promo, (c) returns a single `Offer` struct (delta price, bundle savings, promo id). Must fail-closed if the promo is not admin-approved for that combo.
- **Retire eventually:** Ad-hoc "recommended add-on" price math in voice `aiOrchestrator.ts`.

## 6. Attempt to schedule immediately

- **Authoritative:** `supabase/functions/jobber-availability` (real-time slots via local mirror) + `src/hooks/useSmartAvailability.ts` + `_shared/slotOffer.ts` (canonical offered-slot ledger) + `src/components/booking/DateFirstCalendar.tsx` for web.
- **Missing:** A channel-neutral `offerNextSlots(session, { count: 2-3 })` wrapper around `jobber-availability` + `slotOffer.ts` that voice and future SMS both call. Today voice parses transcripts to reconstruct offered slots.
- **Retire eventually:** Transcript-scanning slot inference inside `aiOrchestrator.ts` post-yes rail.

## 7. Customer accepts → normal Jobber booking

- **Authoritative:** Existing booking handler (`_shared/bookingPreparation.ts` + Jobber client + `create-jobber-booking` edge function) + `slotOffer.ts` reservation guards + `_shared/bookingEmails.ts` for confirmations.
- **Missing:** Nothing new — voice controller invokes the same booking edge function with the reserved `slotOffer` id. Voice remains dry-run until beta exit.
- **Retire eventually:** No duplicates identified; keep as-is.

## 8. Hesitation / price objection → approved incentive only

- **Authoritative:** Admin-managed promotion config (same table `calculate-quote` re-validates) + `_shared/availabilityEngine` (gap/route-density signals already used for slot scoring).
- **Missing:** A server-side `evaluateIncentiveEligibility(session, reason)` in `_shared/incentives/` that returns an approved incentive **only** when: (a) an active admin promo matches the objection reason (route-gap, same-week fill, off-peak), (b) the slot ranker in `_shared/availabilityEngine` confirms the operational reason is real, (c) the incentive was pre-authorized (no free-form values). Returns `null` otherwise. The AI never sees a knob — it either receives an incentive object to speak or it does not.
- **Retire eventually:** Any hard-coded discount language in prompts; ensure `aiOrchestrator.ts` cannot narrate a discount unless this function returned one.

## 9. Still no booking → existing proposal / follow-up pipeline

- **Authoritative:** `supabase/functions/save-quote` (persists version, mints resume token, supersedes older versions), `_shared/bookingEmails.ts` / Resend email templates, `send-sms` orchestrator, `_shared/campaignEngine.ts` + `campaign-event` (enrolls unbooked-quote follow-up sequence).
- **Missing:** A single `finalizeSalesSession(session, outcome: "unbooked")` in `_shared/salesEngine/` that: calls `save-quote` with the canonical quote result, triggers the resume-link email/SMS through existing templates, and emits the `quote_saved` campaign event exactly once. Voice today has no path into this pipeline.
- **Retire eventually:** Any voice-side quote persistence in `quoteSession.ts` that does not go through `save-quote` — `quote_sessions` stays as the live-conversation working copy, but the authoritative saved artifact must always be a `save-quote` row.

## Cross-cutting proposal: `_shared/salesEngine/`

Create one edge-shared package that composes the modules above:

```text
supabase/functions/_shared/salesEngine/
  serviceIntent.ts        # thin re-export of src/lib/pricing resolver
  intakeManifest.ts       # derived from pricingEngine
  priceQuote.ts           # wraps calculate-quote
  complementaryOffer.ts   # steps 4 + 5
  scheduleOffer.ts        # step 6 (jobber-availability + slotOffer)
  bookNow.ts              # step 7
  incentive.ts            # step 8
  finalize.ts             # step 9 (save-quote + campaigns)
  index.ts                # runSalesTurn(session, utterance, channel)
```

Voice `workflowController.runTurn` becomes a ~30-line adapter over `runSalesTurn`. Web booking flow keeps its React UI but delegates pricing/scheduling calls to the same helpers, ensuring one code path.

## Suggested execution order (for a later approval)

1. Extract `SERVICE_INTAKE_MANIFEST` + retire `intakeSchemas.ts` (steps 1–2).
2. Move partial-window pricing into the canonical engine (step 3).
3. Build `complementaryOffer.ts` + retire ad-hoc upsell math (steps 4–5).
4. Route voice slot offers through `slotOffer.ts` via `scheduleOffer.ts` (step 6).
5. Wire voice booking to existing `create-jobber-booking` (step 7, still dry-run).
6. Add `incentive.ts` guarded by admin promo config + availability signals (step 8).
7. Add `finalize.ts` bridging voice unbooked outcomes to `save-quote` + campaigns (step 9).
8. Collapse `workflowController` onto `runSalesTurn`; delete the parallel voice-only business logic.

Each step is independently testable against existing parity suites (`engine.parity`, `engine.bundleParity`, campaign guard tests, availability integration tests).
