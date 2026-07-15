
# Plan — Booking UX Lift + Solar/Screen as First-Class Services

Two parallel workstreams. Stream 1 is presentational-only and low risk. Stream 2 touches the pricing engine (client + server) you just validated end-to-end, so it must go through the exact same shape/adapters the existing services use — no special cases.

## Stream 1 — UX polish (frontend only)

### 1A. Labeled progress stepper
- Replace the bare `<Progress value=… />` in `src/components/booking/BookingFlow.tsx` with a 4-step labeled indicator: **Review → Your info → Pick a time → Confirmed**.
- Current step highlighted, completed steps show a check, upcoming steps are muted.
- Mobile: horizontal scroll-free, condensed labels under 480 px.
- New small component `src/components/booking/BookingStepper.tsx`. No state or logic changes.

### 1B. Add-on value cards with price anchors
- Rework the *collapsed* state in `IntentFirstServiceSelector.tsx` so each unselected add-on shows: icon tile, one-line benefit copy, and a "from $X" anchor pulled from the existing server-computed `servicePrices` estimate (already available). If no estimate yet, keep "Get instant pricing".
- Add a "Included in your plan" badge on cards when a plan tier already bundles that service (data available on `bundle.additionalServicesIncluded`).
- Same file only. No pricing math added — reads existing values.

## Stream 2 — Solar Panel Cleaning + Screen Repair as first-class services

Rate rules (from you):
- **Solar Panel Cleaning:** `$10 × panels` (integer, min 1 when enabled).
- **Screen Repair:** `$35 × screens` (integer, min 1 when enabled).

Both flow through the existing architecture — no special-case code, no lead-capture behavior. They behave identically to House Wash / Roof Cleaning: toggle → quantity input → server calc → line item on quote → Jobber line item → visible in AI chat/pricing tools → schedulable duration.

### 2A. Shared type surface
`src/types/homeowner.ts`
- Extend `AdditionalServices`:
  ```
  solarPanelCleaning: { enabled: boolean; panelCount: number };
  screenRepair:       { enabled: boolean; screenCount: number };
  ```
- Extend `ServicePrices` with `solarPanelCleaning: number` and `screenRepair: number`.
- Update `DEFAULT_ADDITIONAL_SERVICES` and `DEFAULT_SERVICE_PRICES`.

### 2B. Canonical pricing engine — client
`src/lib/pricing/engine.ts` (+ `toQuoteInput.ts`, `fromQuoteResult.ts`)
- Register two new line-item keys: `solar_panel_cleaning`, `screen_repair`.
- Calc: `amount = qty × unitPrice`. Components object mirrors `qty` and `unitPrice` for auditability.
- `toQuoteInput` forwards the enable flags + counts.
- `fromQuoteResult` maps `line.amount` back to `servicePrices.solarPanelCleaning` / `.screenRepair` using the same `byKey`/`comp` pattern used for every other service.
- Included in `additionalServicesTotal`.

### 2C. Canonical pricing engine — server
`supabase/functions/_shared/pricingEngine.ts` and `calculate-quote/index.ts`
- Mirror 2B on the server. Same keys, same math, same component names — server is authoritative.
- No change to config loader; unit prices live in the engine as constants next to the other simple per-unit services (matching existing pattern). If a pricing_config row is preferred, I'll surface it; but "no special case" reads as: keep them inline with the same style used today.
- Extend the server engine tests (`pricingEngine_test.ts`, `engine.test.ts`) with per-unit cases and edge cases (0 qty disabled, negative rejected, non-integer floored).
- Bundles: add-on discount % applied to these two exactly like other add-ons — no bespoke branching. Verified in `engine.bundleParity.test.ts`.

### 2D. Booking payload + Jobber line items
`src/components/booking/BookingFlow.tsx` → `buildServicesArray()`
- Two new branches, structurally identical to Roof/House Wash, feeding `service: 'solar_panels'` and `service: 'screen_repair'` names + `description: 'N panels'` / `'N screens'`.
- `jobber-create-booking` already forwards `services[]` verbatim as Jobber line items — no server change needed beyond the engine recompute path already validated.
- Duration estimate: +30 min per service block (matches Roof/House Wash ratios in `estimatedDuration`).

### 2E. Service selection UI
`src/components/homeowner/IntentFirstServiceSelector.tsx`
- Add two new `ServiceCard` renderers with quantity inputs (same UX pattern as Driveway sqft input).
- Insert into `serviceOrder` array. Featured logic already handles arbitrary keys.
- `AdditionalServicesForm.tsx` (legacy surface) gets matching cards for parity.

### 2F. AI chat + MCP tools
- `src/lib/mcp/tools/list-services.ts` — add both services with brief descriptions.
- `src/lib/mcp/tools/get-pricing-info.ts` — expose per-unit rates.
- `supabase/functions/_shared/aiTools.ts` and `chat-quote/index.ts` — accept `solarPanelCount` / `screenRepairCount` in the quote intent so AI-generated quotes include them.
- `supabase/functions/ai-chat/index.ts` prompts updated to mention both services.

### 2G. Bundle presentation
- `BundleBuilder.tsx` / `bundleTiers` — no logic change; the two services are surfaced via `additionalServicesIncluded` copy where the business chooses to include them. For now they're standalone add-ons available to all tiers (matches Driveway/Pressure treatment).

## Out of scope for this pass

- Scheduling logic, availability, drive-time, Jobber mutation shapes, authorization, suppression.
- Redesigning the tier grid, review-step upsell, error/pending polish (Stream C/D from the earlier audit). Ready to ship next after this lands.

## Verification

- Unit: engine tests (client + server) for both new services; bundle parity test; `fromQuoteResult` test.
- Integration: `calculate-quote` returns matching line items; `useServerQuoteCalculation` displays them.
- Manual smoke: toggle each service in the intent-first selector, confirm totals update, complete review step, confirm Jobber payload includes both line items. **No live Jobber write** — inspect the client-side payload only.
- No changes to the just-validated end-to-end controlled test.

## Files touched (planned)

Frontend: `types/homeowner.ts`, `lib/pricing/engine.ts`, `lib/pricing/toQuoteInput.ts`, `lib/pricing/fromQuoteResult.ts`, `components/booking/BookingFlow.tsx`, `components/booking/BookingStepper.tsx` (new), `components/homeowner/IntentFirstServiceSelector.tsx`, `components/homeowner/AdditionalServicesForm.tsx`, `lib/mcp/tools/list-services.ts`, `lib/mcp/tools/get-pricing-info.ts`, plus tests.

Server: `supabase/functions/_shared/pricingEngine.ts`, `supabase/functions/_shared/aiTools.ts`, `supabase/functions/calculate-quote/index.ts`, `supabase/functions/chat-quote/index.ts`, `supabase/functions/ai-chat/index.ts`, plus tests.

## Risk

Stream 2 modifies the same engine files that gate the validated production booking path. Every touch is additive (new keys, new fields), never mutating existing keys/components, so parity tests should stay green. If any existing parity/bundle test regresses I'll stop and report before continuing.
