
# Phase 4C-β.4A — Window Scope Classification & Progressive Branching

This is a large, high-risk change (touches pricing, orchestrator, DB, voice, tests). Below is the plan I'd like your approval on before I start editing files. It's structured so pricing parity, CallRail, and Vapi provisioning are provably untouched.

## Branch classification model

Add a canonical classifier in `_shared/windowIntent.ts` with pure functions:
- `classifyWindowIntent(utterance, priorFacts)` → `{ customerType, windowCleaningScope, windowCleaningSides?, windowCount?, areas?, commercialSignals? }`
- Keyword lists for commercial (storefront, office, church, warehouse, apartment common area, property-management…), partial ("only", "just", "a few", "N windows", "front/back/upstairs/patio"), whole-home ("all", "whole house", "my windows").
- Terminology normalizer scoped to `services.includes("windowCleaning")`:
  - "outside only", "exterior only", "outside glass only", "just the outsides" → `outside_only`
  - "inside and outside", "both sides", "full service", "interior and exterior" → `inside_and_outside`
- Never interprets "exterior only" globally; only when window cleaning is the active service.

## Quote Session schema extension

Migration adds these fields (as jsonb columns on `quote_sessions`, or nested inside existing `fields` jsonb — I'll use `fields` jsonb to avoid duplicate storage and keep parity guarantees):
- `customerType`: 'residential' | 'commercial' | 'unknown'
- `windowCleaningScope`: 'whole_home' | 'partial' | 'commercial_custom'
- `windowCleaningSides`: 'outside_only' | 'inside_and_outside'
- `windowCount`, `partialAreas`, `partialAccessNotes`
- `commercialPropertyType`, `commercialLocations[]`, `commercialFrequency`, `commercialScopeNotes`
- `preferredContactMethods[]`, `humanPricingRequired`, `bidRequestStatus`

Add DB column `bid_request_status text` and `human_pricing_required bool` for admin queries; everything else lives inside `fields` jsonb. Update `computeRequired` / `nextQuestion` / `mergeFields` to branch on scope.

## Partial-window pricing rule

Add a canonical helper `computePartialWindowPrice({ windowCount, sides })` in `src/lib/pricing/partialWindow.ts` (shared with edge via a mirrored `supabase/functions/_shared/partialWindowPricing.ts` — same formula, one source of truth doc):
```
sidesMultiplier = sides === 'inside_and_outside' ? 2 : 1
price = windowCount * sidesMultiplier * 10
```
- Never applied when `windowCleaningScope !== 'partial'`.
- Whole-home path calls the existing pricing engine unchanged (parity tests must stay green).
- Rule versioned as `partial_window_v1` and stored on the session.

## Orchestrator changes (`aiOrchestrator.ts`)

- Before asking window questions, run `classifyWindowIntent` on latest utterance and merge results into the session via existing `persistFacts` → `syncFromFacts`.
- Replace ambiguous "exterior only?" prompt with: "For the window cleaning, do you want the outside surfaces only, or both inside and outside?"
- Route:
  - `commercial_custom` → collect commercial facts, respond with Ben-review copy, ask for preferred contact method, then ask only for details for that method.
  - `partial` → collect windowCount + sides + area + access; compute price via `computePartialWindowPrice`; store on session; qualify with the "smaller jobs at $10 per window side" line.
  - `whole_home` → unchanged canonical engine path.
- Scope-change handling: if scope flips whole_home ↔ partial, invalidate only price/sqft-dependent fields, preserve address/contact/notes/history.
- Question-repetition guard: `nextQuestion()` skips any field already `captured|verified|corrected|derived`.

## Address behavior

- Persist address as soon as captured; do not re-ask.
- Serviceability validation runs async; does not block progressive collection.
- Existing voice rough-quote rail already bypasses address; extend guard to whole-home window flow so slow validation never re-prompts.

## Commercial multi-location

`fields.commercialLocations` is `Array<{ address, propertyType?, windowsEstimate?, stories?, sides?, frequency?, accessNotes?, notes? }>`. Orchestrator merges rather than flattening to a note.

## Response format for commercial

After scope is sufficient, assistant says: "Thanks. I've saved the scope and locations. We'll prepare a custom bid, and Ben will reach out with the price. What's the best way to contact you: text, email, or a phone call?" — then persists `preferredContactMethods` and asks only for the matching contact details. Sets `bid_request_status = 'commercial_bid_requested'`, `human_pricing_required = true`.

## Tests

New / extended:
- `_shared/windowIntent_test.ts` — classification, terminology normalization, "exterior only" scoped only to window cleaning, commercial keywords, partial keywords, ambiguity handling.
- `_shared/partialWindowPricing_test.ts` — 1×outside=$10, 1×both=$20, 5×outside=$50, 5×both=$100, no-sqft-path.
- `_shared/quoteSession_test.ts` — extend: scope flip preserves address/contact, invalidates only dependent fields; multi-location persistence; contact-preference gating; question non-repetition.
- `_shared/aiOrchestrator_test.ts` — voice/web/sms all mutate same session id; commercial path never invokes residential pricing tool; window question wording asserted.
- `src/lib/pricing/engine.parity.test.ts` — leave untouched; must still pass to prove whole-home parity.
- Voice booking-blocked-in-beta assertion in `voiceAdapter` test remains green.

## Deployment

- Migration: adds `bid_request_status`, `human_pricing_required` columns + indexes; extends jsonb usage (no destructive changes).
- Redeploy `voice-llm-adapter` and any other edge functions importing changed shared modules.
- Bump `BUILD_ID` → `voice-adapter-4C-b.4A-window-scope-classification`.
- Add flags: `progressiveQuoteSession`, `windowScopeClassification`, `partialWindowPricing`, `commercialCustomBidIntake` — all `true`.
- Verify 401 on unauthenticated POST to `voice-llm-adapter` unchanged.
- No CallRail / Vapi provisioning / transfer changes. No production booking. No call to Ben's cell.

## Files I plan to add / edit

Add:
- `supabase/functions/_shared/windowIntent.ts` + `_test.ts`
- `supabase/functions/_shared/partialWindowPricing.ts` + `_test.ts`
- `src/lib/pricing/partialWindow.ts` + `.test.ts` (client mirror; single formula documented)

Edit:
- `supabase/functions/_shared/quoteSession.ts` (+ `_test.ts`) — new fields, scope-aware `computeRequired`, `nextQuestion`, scope-flip invalidation, multi-location merge.
- `supabase/functions/_shared/aiOrchestrator.ts` — pre-question classification, branch dispatch, wording change, commercial contact-method flow.
- `supabase/functions/_shared/conversationState.ts` — allow partial/commercial tool sets under voice + web + sms.
- `supabase/functions/_shared/buildMarker.ts` — new BUILD_ID + flags.
- `supabase/functions/_shared/buildMarker_test.ts` — assert new flags.
- Migration for new columns.

## Explicit non-goals for this phase

- No changes to whole-home window pricing values or formulas.
- No changes to any other service's pricing.
- No SMS sends, no unsolicited outreach.
- No dropped-call SMS workflow beyond ensuring facts are structured for later use.
- No CallRail routing changes, no phone provisioning, no transfer config, no call to Ben.
- Voice production booking remains blocked.

## Completion report I will return

Branch classification architecture, files changed, whole-home behavior confirmation, partial behavior + exact pricing, terminology normalization, commercial intake behavior, multi-location support, contact preference behavior, schema changes, persistence behavior, non-repetition safeguards, pricing parity result, typecheck result, full Deno result, Vitest result, deploy result, new build marker, diagnostic flags, and explicit confirmations (no pricing changes elsewhere, no CallRail change, no provisioning, no transfer config, no call to Ben, no production booking). Final status: READY FOR WINDOW-SCOPE PROGRESSIVE TEST or NOT READY with blocker.

Approve and I'll execute end-to-end.
