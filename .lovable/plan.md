## What we're building

A third option under "Service Type" in the window-cleaning card:

- **Exterior Only** — outside windows (unchanged)
- **Full Service — Inside + Outside** — complete clean (renamed)
- **$99 Special — 10 Exterior Windows** — flat $99, screens NOT included, screens must be removed before arrival

The complimentary-screens green box stays under the first two options only. The $99 card carries its own visually distinct notice (amber/warning tone) making the "no screens / remove before arrival" terms unmissable.

## Behavior when the $99 special is selected

- Window-cleaning line becomes a flat $99 via the existing `window_promo_99` promotion in the pricing engine (already fully implemented server-side, including limits, dates, and Jobber snapshot).
- Additional services (gutters, house wash, etc.) still price normally alongside it.
- Interior, screens, tracks, condition upgrades, and advanced window details are hidden/disabled while the promo is selected — the promo is a fixed offer.
- If the admin toggle for the promo is off, the option is hidden entirely (fail-closed). No fake $99 ever shown when inactive.

## Files to change (frontend only, no schema changes)

1. `src/types/homeowner.ts` — extend `windowCleaningType` union to include `'promo_99'`.
2. `src/components/homeowner/IntentFirstServiceSelector.tsx`
   - Rename "Inside + Outside" → "Full Service — Inside + Outside".
   - Add third radio card: "$99 Special — 10 Exterior Windows".
   - Move the green complimentary-screens box so it only renders for `exterior` or `both`.
   - Render distinct amber notice under the promo card: "Screens NOT included · Please remove screens before we arrive · Up to 10 standard exterior windows".
   - Hide Window Condition + Advanced Window Details when promo selected.
3. `src/pages/Index.tsx` (and `ServiceLanding.tsx` if it also owns pricing state)
   - Read the `window_promo_99` config from `pricing_config` (already loaded for pricing).
   - When `windowCleaningType === 'promo_99'`, pass `promotion: { id: promoId, windowCount: 10 }` into the pricing engine and into `save-quote`.
   - Hide the promo option in the selector when the config is missing / inactive / out of effective window.
4. `src/components/booking/ServiceReviewStep.tsx` and `BookingFlow.tsx` — display "$99 Special (10 Exterior Windows)" label instead of "Exterior Only" when promo is selected.
5. Small unit test in `src/lib/pricing/engine.promotion.test.ts` covering the UI-driven selection payload (`windowCleaningType === 'promo_99'` → engine yields flat $99).

## Guardrails preserved

- Pricing math stays server-authoritative via `authoritativeQuote` — no client can invent a $99 price; the engine rejects the promotion if the admin config is inactive or missing.
- Promotion snapshot (id, version, prep instructions) travels into the saved quote and Jobber notes exactly as it does today for admin-applied promos.
- Zero changes to database schema, RLS, or edge functions.

## Out of scope

- No changes to campaigns, SMS, email, or Jobber sync.
- No new admin UI (the existing `PromotionManager` already controls activation).
