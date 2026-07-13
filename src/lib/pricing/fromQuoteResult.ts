/**
 * ============================================================================
 * fromQuoteResult — LOSSLESS server → legacy display adapter.
 * ============================================================================
 * Transforms the authoritative `QuoteResult` returned by the `calculate-quote`
 * Edge Function into the legacy `ServicePrices` display shape consumed by the
 * existing UI components (breakdown rows, summaries, plan cards).
 *
 * STRICT RULES — this adapter is purely structural:
 *  - It NEVER calculates a production price.
 *  - It NEVER applies discounts, minimums, frequencies, surcharges or tier math.
 *  - It NEVER adds service amounts together to derive a NEW price; it only
 *    surfaces totals the server already computed (line-item `amount` and the
 *    server-provided `components`).
 *  - It NEVER invents a missing component. A service that is absent from the
 *    server response is simply not selected → its display value is 0. That 0
 *    means "not part of this quote", NOT a pricing fallback.
 *
 * Every dollar value below originates in the server response.
 */
import type { QuoteResult, QuoteLineItem } from '@/lib/pricing/engine';
import type { ServicePrices } from '@/types/homeowner';
import { DEFAULT_SERVICE_PRICES } from '@/types/homeowner';

function byKey(quote: QuoteResult, key: string): QuoteLineItem | undefined {
  return quote.lineItems.find((li) => li.key === key);
}

/** Read a numeric server-provided component; returns 0 when absent (not selected). */
function comp(li: QuoteLineItem | undefined, name: string): number {
  const v = li?.components?.[name];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * Build the legacy `ServicePrices` view from an authoritative server quote.
 * Pass `null` (no firm/estimated quote) to get the neutral all-zero shape so
 * the UI shows no stale dollar values while loading / unavailable.
 */
export function fromQuoteResult(quote: QuoteResult | null): ServicePrices {
  if (!quote) return { ...DEFAULT_SERVICE_PRICES };

  const win = byKey(quote, 'window_cleaning');
  const house = byKey(quote, 'house_wash');
  const gutter = byKey(quote, 'gutter_cleaning');
  const roof = byKey(quote, 'roof_cleaning');
  const driveway = byKey(quote, 'driveway_cleaning');
  const pressure = byKey(quote, 'pressure_washing');

  const windowCleaningTotal = comp(win, 'windowCleaningTotal');
  const drivewayCleaning = driveway?.amount ?? 0;
  const pressureWashing = comp(pressure, 'pressureWashingTotal') || (pressure?.amount ?? 0);
  const gutterCleaningTotal = comp(gutter, 'gutterCleaningTotal') || (gutter?.amount ?? 0);
  const houseWashTotal = comp(house, 'houseWashTotal') || (house?.amount ?? 0);
  const roofCleaning = roof?.amount ?? 0;

  const additionalServicesTotal =
    drivewayCleaning + pressureWashing + gutterCleaningTotal + houseWashTotal + roofCleaning;

  return {
    // Window cleaning (server components)
    exteriorWindows: comp(win, 'exteriorWindows'),
    interiorWindows: comp(win, 'interiorWindows'),
    hardWaterAddon: comp(win, 'hardWaterAddon'),
    frenchPanesAddon: comp(win, 'frenchPanesAddon'),
    solarScreensAddon: comp(win, 'solarScreensAddon'),
    ladderWorkAddon: comp(win, 'ladderWorkAddon'),
    sunroomAddon: comp(win, 'sunroomAddon'),
    windowCleaningTotal,

    // Driveway
    drivewayCleaning,

    // Pressure washing (server components)
    pressureWashing,
    pressureWashingBreakdown: {
      frontPorch: comp(pressure, 'frontPorch'),
      backPatio: comp(pressure, 'backPatio'),
      poolDeck: comp(pressure, 'poolDeck'),
      walkways: comp(pressure, 'walkways'),
    },

    // Gutter (server components)
    gutterCleaning: comp(gutter, 'gutterCleaning'),
    gutterDrainCleaning: comp(gutter, 'gutterDrainCleaning'),
    gutterMinorRepairs: comp(gutter, 'gutterMinorRepairs'),
    gutterGuards: comp(gutter, 'gutterGuards'),
    gutterCleaningTotal,

    // House wash (server components)
    houseWash: comp(house, 'houseWash'),
    houseWashRustSurcharge: comp(house, 'houseWashRustSurcharge'),
    houseWashTotal,

    // Roof
    roofCleaning,

    // Totals — from the authoritative server line-item amounts only.
    additionalServicesTotal,
    grandTotal: typeof quote.total === 'number' ? quote.total : windowCleaningTotal + additionalServicesTotal,
  };
}
