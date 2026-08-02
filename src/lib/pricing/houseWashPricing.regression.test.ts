import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADDITIONAL_SERVICES,
  DEFAULT_HOME_DETAILS,
  type AdditionalServices,
} from '@/types/homeowner';
import { calculateQuote, type QuoteInput } from './engine';
import { fromQuoteResult } from './fromQuoteResult';
import { LIVE_CONFIG } from './__fixtures__/liveConfig';
import { toQuoteInput } from './toQuoteInput';

function calculate(
  services = { ...DEFAULT_ADDITIONAL_SERVICES, houseWash: true },
) {
  const input = toQuoteInput(
    { ...DEFAULT_HOME_DETAILS, squareFootage: 2500, stories: 1 },
    services,
  );
  return calculateQuote(input as QuoteInput, LIVE_CONFIG, 2);
}

describe('House Wash canonical pricing regression', () => {
  it('includes the authoritative base in House Wash total and global subtotal', () => {
    const result = calculate();
    const houseWash = result.lineItems.find((item) => item.key === 'house_wash');
    const prices = fromQuoteResult(result);

    expect(result.status).toBe('firm');
    expect(houseWash?.components?.houseWash).toBeGreaterThan(0);
    expect(houseWash?.components?.houseWashRustSurcharge).toBe(0);
    expect(houseWash?.components?.houseWashTotal).toBe(houseWash?.components?.houseWash);
    expect(prices.houseWash).toBe(houseWash?.components?.houseWash);
    expect(prices.houseWashTotal).toBe(prices.houseWash);
    expect(result.subtotal).toBe(prices.houseWashTotal);
    expect(prices.grandTotal).toBe(result.estimatedTotal ?? result.total);
  });

  it('adds optional rust treatment to House Wash total and global subtotal', () => {
    const result = calculate({
      ...DEFAULT_ADDITIONAL_SERVICES,
      houseWash: true,
      houseWashDetails: {
        ...DEFAULT_ADDITIONAL_SERVICES.houseWashDetails,
        stainType: 'rust',
      },
    });
    const prices = fromQuoteResult(result);

    expect(prices.houseWash).toBeGreaterThan(0);
    expect(prices.houseWashRustSurcharge).toBeGreaterThan(0);
    expect(prices.houseWashTotal).toBe(
      prices.houseWash + prices.houseWashRustSurcharge,
    );
    expect(result.subtotal).toBe(prices.houseWashTotal);
    expect(prices.grandTotal).toBe(result.estimatedTotal ?? result.total);
  });

  it('removes base and rust amounts when House Wash is not selected', () => {
    const result = calculate({
      ...DEFAULT_ADDITIONAL_SERVICES,
      houseWash: false,
      houseWashDetails: {
        ...DEFAULT_ADDITIONAL_SERVICES.houseWashDetails,
        stainType: 'rust',
      },
    });
    const prices = fromQuoteResult(result);

    expect(result.lineItems.some((item) => item.key === 'house_wash')).toBe(false);
    expect(prices.houseWash).toBe(0);
    expect(prices.houseWashRustSurcharge).toBe(0);
    expect(prices.houseWashTotal).toBe(0);
    expect(result.subtotal).toBe(0);
    expect(prices.grandTotal).toBe(0);
  });

  it('aggregates Window, Gutter, House Wash, and Pressure Washing service totals', () => {
    const result = calculate({
      ...DEFAULT_ADDITIONAL_SERVICES,
      windowCleaning: true,
      gutterCleaning: true,
      houseWash: true,
      pressureWashing: {
        ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
        enabled: true,
        frontPorch: { enabled: true, sqft: 100, surfaceType: 'concrete' },
      },
    });
    const prices = fromQuoteResult(result);

    expect(prices.windowCleaningTotal).toBeGreaterThan(0);
    expect(prices.gutterCleaningTotal).toBeGreaterThan(0);
    expect(prices.houseWashTotal).toBeGreaterThan(0);
    expect(prices.pressureWashing).toBeGreaterThan(0);
    expect(result.subtotal).toBe(
      prices.windowCleaningTotal +
        prices.gutterCleaningTotal +
        prices.houseWashTotal +
        prices.pressureWashing,
    );
    expect(prices.grandTotal).toBe(result.estimatedTotal ?? result.total);
  });

  it('prices each supported service individually from canonical inputs', () => {
    const cases = [
      ['Window Cleaning', { ...DEFAULT_ADDITIONAL_SERVICES, windowCleaning: true }, 'window_cleaning'],
      [
        'Driveway Cleaning',
        {
          ...DEFAULT_ADDITIONAL_SERVICES,
          drivewayCleaning: {
            ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning,
            enabled: true,
          },
        },
        'driveway_cleaning',
      ],
      [
        'Pressure Washing',
        {
          ...DEFAULT_ADDITIONAL_SERVICES,
          pressureWashing: {
            ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
            enabled: true,
            frontPorch: { enabled: true, sqft: 100, surfaceType: 'concrete' },
          },
        },
        'pressure_washing',
      ],
      ['Gutter Cleaning', { ...DEFAULT_ADDITIONAL_SERVICES, gutterCleaning: true }, 'gutter_cleaning'],
      ['House Wash', { ...DEFAULT_ADDITIONAL_SERVICES, houseWash: true }, 'house_wash'],
      [
        'Roof Cleaning',
        {
          ...DEFAULT_ADDITIONAL_SERVICES,
          roofCleaning: true,
          roofRiskFlags: {
            knownDamage: false,
            extremePitch: false,
            fragileMaterial: false,
            unusualAccess: false,
          },
        },
        'roof_cleaning',
      ],
      [
        'Solar Panel Cleaning',
        {
          ...DEFAULT_ADDITIONAL_SERVICES,
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
        },
        'solar_panel_cleaning',
      ],
      [
        'Screen Repair',
        {
          ...DEFAULT_ADDITIONAL_SERVICES,
          screenRepair: {
            enabled: true,
            screenCount: 2,
            scopeType: 'standard_removable_reusable_frame',
          },
        },
        'screen_repair',
      ],
    ] satisfies Array<[string, AdditionalServices, string]>;

    for (const [serviceName, services, lineItemKey] of cases) {
      const result = calculate(services);
      expect(result.status, serviceName).toBe('firm');
      expect(result.missing, serviceName).toEqual([]);
      expect(
        result.lineItems.find((item) => item.key === lineItemKey)?.amount,
        serviceName,
      ).toBeGreaterThan(0);
      expect(result.subtotal, serviceName).toBeGreaterThan(0);
    }
  });

  it('returns an authoritative line and total for every supported service together', () => {
    const input = toQuoteInput(
      {
        ...DEFAULT_HOME_DETAILS,
        squareFootage: 2500,
        stories: 1,
        advancedWindowConditions: false,
      },
      {
        ...DEFAULT_ADDITIONAL_SERVICES,
        windowCleaning: true,
        drivewayCleaning: {
          ...DEFAULT_ADDITIONAL_SERVICES.drivewayCleaning,
          enabled: true,
        },
        pressureWashing: {
          ...DEFAULT_ADDITIONAL_SERVICES.pressureWashing,
          enabled: true,
          frontPorch: { enabled: true, sqft: 100, surfaceType: 'concrete' },
        },
        gutterCleaning: true,
        houseWash: true,
        roofCleaning: true,
        roofRiskFlags: {
          knownDamage: false,
          extremePitch: false,
          fragileMaterial: false,
          unusualAccess: false,
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
        screenRepair: {
          enabled: true,
          screenCount: 2,
          scopeType: 'standard_removable_reusable_frame',
        },
      },
    );
    const result = calculateQuote(input as QuoteInput, LIVE_CONFIG, 2);
    const prices = fromQuoteResult(result);

    expect(result.status).toBe('firm');
    expect(result.missing).toEqual([]);
    expect(result.lineItems.map((item) => item.key)).toEqual(
      expect.arrayContaining([
        'window_cleaning',
        'driveway_cleaning',
        'pressure_washing',
        'gutter_cleaning',
        'house_wash',
        'roof_cleaning',
        'solar_panel_cleaning',
        'screen_repair',
      ]),
    );
    expect([
      prices.windowCleaningTotal,
      prices.drivewayCleaning,
      prices.pressureWashing,
      prices.gutterCleaningTotal,
      prices.houseWashTotal,
      prices.roofCleaning,
      prices.solarPanelCleaning,
      prices.screenRepair,
    ]).toEqual(expect.arrayContaining([expect.any(Number)]));
    for (const total of [
      prices.windowCleaningTotal,
      prices.drivewayCleaning,
      prices.pressureWashing,
      prices.gutterCleaningTotal,
      prices.houseWashTotal,
      prices.roofCleaning,
      prices.solarPanelCleaning,
      prices.screenRepair,
    ]) {
      expect(total).toBeGreaterThan(0);
    }
    expect(result.subtotal).toBe(
      result.lineItems.reduce((sum, item) => sum + item.amount, 0),
    );
    expect(prices.grandTotal).toBe(result.estimatedTotal ?? result.total);
  });

  it('contains no frontend House Wash or rust price fallback', () => {
    const selector = readFileSync(
      resolve(process.cwd(), 'src/components/homeowner/IntentFirstServiceSelector.tsx'),
      'utf8',
    );
    const details = readFileSync(
      resolve(process.cwd(), 'src/components/homeowner/HouseWashDetailsCard.tsx'),
      'utf8',
    );

    expect(selector).not.toMatch(/houseWash(?:RustSurcharge|Total)?\s*[:=]\s*[1-9]\d*/);
    expect(details).not.toMatch(/rustSurcharge\s*[:=]\s*[1-9]\d*/);
    expect(selector).toContain('servicePrices.houseWash');
    expect(selector).toContain('servicePrices.houseWashTotal');
    expect(selector).not.toMatch(/panelCount\s*\*\s*10|screenCount\s*\*\s*35/);
    expect(selector).not.toMatch(/×\s*\$10|×\s*\$35/);
    expect(details).not.toContain('15%');
  });
});
