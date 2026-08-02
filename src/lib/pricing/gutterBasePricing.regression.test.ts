import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDITIONAL_SERVICES, DEFAULT_HOME_DETAILS } from '@/types/homeowner';
import { fromQuoteResult } from './fromQuoteResult';
import { calculateQuote, type QuoteInput } from './engine';
import { LIVE_CONFIG } from './__fixtures__/liveConfig';
import { toQuoteInput } from './toQuoteInput';

function calculate(gutterAddons = DEFAULT_ADDITIONAL_SERVICES.gutterAddons) {
  const input = toQuoteInput(
    { ...DEFAULT_HOME_DETAILS, squareFootage: 2500, stories: 1 },
    { ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true, gutterAddons },
  );
  return calculateQuote(input as QuoteInput, LIVE_CONFIG, 2);
}

describe('gutter base pricing regression', () => {
  it('includes the authoritative base in the gutter total and global subtotal', () => {
    const result = calculate();
    const gutter = result.lineItems.find((item) => item.key === 'gutter_cleaning');

    expect(result.status).toBe('firm');
    expect(gutter?.amount).toBe(200);
    expect(gutter?.components?.gutterCleaning).toBe(200);
    expect(gutter?.components?.gutterCleaningTotal).toBe(200);
    expect(result.subtotal).toBe(200);
    expect(fromQuoteResult(result).grandTotal).toBe(200);
  });

  it('adds optional drain cleaning to both the gutter total and global subtotal', () => {
    const result = calculate({
      ...DEFAULT_ADDITIONAL_SERVICES.gutterAddons,
      undergroundDrains: { enabled: true, count: '1' },
    });
    const gutter = result.lineItems.find((item) => item.key === 'gutter_cleaning');

    expect(gutter?.components?.gutterCleaning).toBe(200);
    expect(gutter?.components?.gutterDrainCleaning).toBe(100);
    expect(gutter?.components?.gutterCleaningTotal).toBe(300);
    expect(result.subtotal).toBe(300);
    expect(fromQuoteResult(result).gutterCleaningTotal).toBe(300);
    expect(fromQuoteResult(result).grandTotal).toBe(300);
  });

  it('removes base and add-on amounts when Gutter Cleaning is removed', () => {
    const input = toQuoteInput(
      { ...DEFAULT_HOME_DETAILS, squareFootage: 2500, stories: 1 },
      {
        ...DEFAULT_ADDITIONAL_SERVICES,
        gutterCleaning: false,
        gutterAddons: {
          ...DEFAULT_ADDITIONAL_SERVICES.gutterAddons,
          undergroundDrains: { enabled: true, count: '1' },
        },
      },
    );
    const result = calculateQuote(input as QuoteInput, LIVE_CONFIG, 2);

    expect(result.lineItems.some((item) => item.key === 'gutter_cleaning')).toBe(false);
    expect(result.subtotal).toBe(0);
    expect(fromQuoteResult(result).gutterCleaningTotal).toBe(0);
    expect(fromQuoteResult(result).grandTotal).toBe(0);
  });

  it('contains no frontend gutter price fallback or Included label', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/homeowner/IntentFirstServiceSelector.tsx'),
      'utf8',
    );

    expect(source).not.toContain("'Included'");
    expect(source).not.toMatch(/gutterCleaning\s*[:=]\s*\d+/);
    expect(source).toContain('servicePrices.gutterCleaning');
    expect(source).toContain('servicePrices.gutterCleaningTotal');
  });
});
