import { describe, expect, it } from 'vitest';
import { DEFAULT_ADDITIONAL_SERVICES, DEFAULT_HOME_DETAILS, type AdditionalServices } from '@/types/homeowner';
import { LIVE_CONFIG } from './__fixtures__/liveConfig';
import { calculateQuote } from './engine';
import { fromQuoteResult } from './fromQuoteResult';
import { evaluateQuoteIntegrity } from './quoteIntegrity';
import { toQuoteInput } from './toQuoteInput';

const home = {
  ...DEFAULT_HOME_DETAILS,
  squareFootage: 2500,
  stories: 2 as const,
  enclosedPatioProfile: 'none' as const,
};

function completeServices(): AdditionalServices {
  return {
    ...DEFAULT_ADDITIONAL_SERVICES,
    windowCleaning: true,
    houseWash: true,
    gutterCleaning: true,
    roofCleaning: true,
    roofRiskFlags: { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false },
    drivewayCleaning: { enabled: true, sqft: 400, surfaceType: 'concrete' },
    pressureWashing: {
      ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
      enabled: true,
      frontPorch: { enabled: true, sqft: 80, surfaceType: 'concrete' },
      backPatio: { enabled: true, sqft: 200, surfaceType: 'concrete' },
    },
    solarPanelCleaning: {
      enabled: true,
      panelCount: 20,
      stories: 1,
      accessType: 'standard_residential',
      knownDamage: false,
      extremePitch: false,
      fragileMaterial: false,
      unusualAccess: false,
    },
    screenRepair: { enabled: true, screenCount: 1, scopeType: 'standard_removable_reusable_frame' },
  };
}

function quote(services: AdditionalServices) {
  return calculateQuote(toQuoteInput(home, services), LIVE_CONFIG, 2);
}

describe('multi-service authoritative readiness and subtotal integrity', () => {
  it('reuses shared home size and stories for House Wash, Gutter Cleaning, and Roof Cleaning', () => {
    const result = quote(completeServices());
    for (const key of ['house_wash', 'gutter_cleaning', 'roof_cleaning']) {
      expect(result.lineItems.find((line) => line.key === key)?.quantity).toBe(2500);
    }
    expect(toQuoteInput(home, completeServices()).homeDetails).toMatchObject({ squareFootage: 2500, stories: 2 });
    expect(result.missing).not.toEqual(expect.arrayContaining(['squareFootage', 'stories']));
  });

  it('prices every complete supported service and reconciles the canonical subtotal', () => {
    const services = completeServices();
    const result = quote(services);
    const prices = fromQuoteResult(result);
    const expectedKeys = [
      'window_cleaning', 'house_wash', 'gutter_cleaning', 'roof_cleaning',
      'driveway_cleaning', 'pressure_washing', 'solar_panel_cleaning', 'screen_repair',
    ];
    expect(result.status).toBe('firm');
    expect(result.lineItems.map((line) => line.key)).toEqual(expect.arrayContaining(expectedKeys));
    expect(result.subtotal).toBe(result.lineItems.reduce((sum, line) => sum + line.amount, 0));
    expect([
      prices.windowCleaningTotal, prices.houseWashTotal, prices.gutterCleaningTotal,
      prices.roofCleaning, prices.drivewayCleaning, prices.pressureWashing,
      prices.solarPanelCleaning, prices.screenRepair,
    ].every((price) => price > 0)).toBe(true);
    expect(prices.pressureWashingBreakdown.frontPorch).toBeGreaterThan(0);
    expect(prices.pressureWashingBreakdown.backPatio).toBeGreaterThan(0);
    const integrity = evaluateQuoteIntegrity({ services, prices, phase: 'firm', quote: result });
    expect(integrity).toMatchObject({ selectedCount: 8, pricedCount: 8, representedCount: 8, actionable: true });
  });

  it('uses the shared story count for solar access rather than retaining a stale duplicate', () => {
    const input = toQuoteInput(home, completeServices());
    expect(input.additionalServices.solarPanelCleaning?.stories).toBe(2);
  });

  it('keeps complete services independently priced while an incomplete service blocks action', () => {
    const services = {
      ...completeServices(),
      windowCleaning: false,
      gutterCleaning: false,
      roofCleaning: false,
      pressureWashing: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing, enabled: false },
      solarPanelCleaning: { ...DEFAULT_ADDITIONAL_SERVICES.solarPanelCleaning, enabled: false },
      screenRepair: { ...DEFAULT_ADDITIONAL_SERVICES.screenRepair, enabled: false },
      drivewayCleaning: { enabled: true, sqft: 0, surfaceType: 'concrete' as const },
    };
    const result = quote(services);
    const prices = fromQuoteResult(result);
    const integrity = evaluateQuoteIntegrity({ services, prices, phase: 'missing_information', quote: result });
    expect(result.status).toBe('missing_information');
    expect(result.lineItems.some((line) => line.key === 'house_wash')).toBe(true);
    expect(result.lineItems.some((line) => line.key === 'driveway_cleaning')).toBe(false);
    expect(integrity.services.find((service) => service.id === 'houseWash')?.state).toBe('priced');
    expect(integrity.services.find((service) => service.id === 'drivewayCleaning')).toMatchObject({
      state: 'missing', message: 'Select a driveway size',
    });
    expect(integrity.actionable).toBe(false);
  });

  it('reports the first actual canonical requirement instead of a generic unavailable state', () => {
    const cases: Array<{ services: AdditionalServices; id: string; message: string }> = [
      {
        services: { ...DEFAULT_ADDITIONAL_SERVICES, drivewayCleaning: { ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning, enabled: true, sqft: 0 } },
        id: 'drivewayCleaning',
        message: 'Select a driveway size',
      },
      {
        services: { ...DEFAULT_ADDITIONAL_SERVICES, pressureWashing: { ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing, enabled: true } },
        id: 'pressureWashing',
        message: 'Select at least one area',
      },
      {
        services: { ...DEFAULT_ADDITIONAL_SERVICES, roofCleaning: true },
        id: 'roofCleaning',
        message: 'Complete roof details',
      },
      {
        services: { ...DEFAULT_ADDITIONAL_SERVICES, solarPanelCleaning: { ...DEFAULT_ADDITIONAL_SERVICES.solarPanelCleaning, enabled: true, panelCount: 0 } },
        id: 'solarPanelCleaning',
        message: 'Enter the number of solar panels',
      },
      {
        services: { ...DEFAULT_ADDITIONAL_SERVICES, screenRepair: { ...DEFAULT_ADDITIONAL_SERVICES.screenRepair, enabled: true, screenCount: 0 } },
        id: 'screenRepair',
        message: 'Enter the number of screens',
      },
    ];

    for (const testCase of cases) {
      const result = quote(testCase.services);
      const integrity = evaluateQuoteIntegrity({
        services: testCase.services,
        prices: fromQuoteResult(result),
        phase: 'missing_information',
        quote: result,
      });
      expect(integrity.services.find((service) => service.id === testCase.id)?.message).toBe(testCase.message);
      expect(integrity.actionable).toBe(false);
    }
  });

  it('classifies nonstandard Screen Repair as explicit manual review and excludes it from the firm lines', () => {
    const services = {
      ...DEFAULT_ADDITIONAL_SERVICES,
      houseWash: true,
      screenRepair: { enabled: true, screenCount: 1, scopeType: 'screen_door' as const },
    };
    const result = quote(services);
    const prices = fromQuoteResult(result);
    const integrity = evaluateQuoteIntegrity({ services, prices, phase: 'manual_review_required', quote: result });
    expect(result.manualReviewServiceKeys).toContain('screen_repair');
    expect(result.lineItems.some((line) => line.key === 'screen_repair')).toBe(false);
    expect(integrity.services.find((service) => service.id === 'screenRepair')).toMatchObject({
      state: 'manual_review', message: 'Price confirmed after screen details are reviewed', price: 0,
    });
    expect(integrity.actionable).toBe(false);
  });

  it('does not let planning-only roof pitch affect the authoritative result', () => {
    const services = completeServices();
    const walkable = quote({ ...services, roofPitch: 'walkable' });
    const steep = quote({ ...services, roofPitch: 'steep' });
    expect(fromQuoteResult(steep).roofCleaning).toBe(fromQuoteResult(walkable).roofCleaning);
    expect(steep.status).toBe('firm');
  });

  it('clears all service prices while recalculating instead of preserving a stale actionable total', () => {
    const services = completeServices();
    const result = quote(services);
    const stalePrices = fromQuoteResult(result);
    const integrity = evaluateQuoteIntegrity({ services, prices: stalePrices, phase: 'loading', quote: null });
    expect(integrity.actionable).toBe(false);
    expect(integrity.services.every((service) => service.price === 0 && service.message === 'Recalculating')).toBe(true);
  });
});
