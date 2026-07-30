import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDITIONAL_SERVICES } from '@/types/homeowner';
import { selectedServiceSlugs } from './toQuoteInput';

describe('selectedServiceSlugs', () => {
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
