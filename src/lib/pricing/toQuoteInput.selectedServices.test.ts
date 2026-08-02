import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDITIONAL_SERVICES, DEFAULT_HOME_DETAILS } from '@/types/homeowner';
import { selectedServiceSlugs, toQuoteInput } from './toQuoteInput';

describe('selectedServiceSlugs', () => {
  it('sends Gutter Cleaning as the canonical required base service', () => {
    const input = toQuoteInput(
      { ...DEFAULT_HOME_DETAILS, squareFootage: 2500 },
      { ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true },
    );

    expect(input.additionalServices.gutterCleaning).toBe(true);
    expect(input.additionalServices.gutterAddons).toEqual(
      DEFAULT_ADDITIONAL_SERVICES.gutterAddons,
    );
  });

  it('excludes disabled nested service objects', () => {
    expect(selectedServiceSlugs(DEFAULT_ADDITIONAL_SERVICES)).toEqual([]);
  });

  it('returns only explicitly enabled services in canonical order', () => {
    expect(selectedServiceSlugs({
      ...DEFAULT_ADDITIONAL_SERVICES,
      houseWash: true,
      drivewayCleaning: {
        ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning,
        enabled: true,
      },
      screenRepair: {
        ...DEFAULT_ADDITIONAL_SERVICES.screenRepair,
        enabled: true,
      },
    })).toEqual(['houseWash', 'drivewayCleaning', 'screenRepair']);
  });
});
