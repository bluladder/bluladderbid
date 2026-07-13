import { describe, it, expect } from 'vitest';
import { fromQuoteResult } from './fromQuoteResult';
import type { QuoteResult } from './engine';

function baseQuote(partial: Partial<QuoteResult>): QuoteResult {
  return {
    engineVersion: 'v1', ruleVersion: 3, status: 'firm', firm: true,
    lineItems: [], subtotal: 0, discount: null, total: 0,
    estimatedDurationMinutes: null, missing: [], manualReviewReasons: [],
    explanation: '', trace: [], jobberLineItems: [], promotion: null,
    ...partial,
  };
}

describe('fromQuoteResult adapter', () => {
  it('returns a neutral all-zero shape when no quote (no $ fallback)', () => {
    const sp = fromQuoteResult(null);
    expect(sp.grandTotal).toBe(0);
    expect(sp.windowCleaningTotal).toBe(0);
    expect(sp.pressureWashingBreakdown.frontPorch).toBe(0);
  });

  it('surfaces ONLY server-provided component values', () => {
    const quote = baseQuote({
      total: 500,
      lineItems: [
        { key: 'window_cleaning', label: 'W', quantity: 1, unit: 'sqft', baseAmount: 300,
          adjustments: [], minimumApplied: false, amount: 320,
          components: { exteriorWindows: 200, interiorWindows: 100, hardWaterAddon: 20, windowCleaningTotal: 320 } },
        { key: 'pressure_washing', label: 'P', quantity: 1, unit: 'flat', baseAmount: 180,
          adjustments: [], minimumApplied: false, amount: 180,
          components: { frontPorch: 80, backPatio: 100, poolDeck: 0, walkways: 0, pressureWashingTotal: 180 } },
      ],
    });
    const sp = fromQuoteResult(quote);
    expect(sp.exteriorWindows).toBe(200);
    expect(sp.interiorWindows).toBe(100);
    expect(sp.hardWaterAddon).toBe(20);
    expect(sp.windowCleaningTotal).toBe(320);
    expect(sp.pressureWashing).toBe(180);
    expect(sp.pressureWashingBreakdown.backPatio).toBe(100);
    expect(sp.grandTotal).toBe(500); // from server total, not summed locally
  });
});
