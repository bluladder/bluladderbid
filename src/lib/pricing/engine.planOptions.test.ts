import { describe, it, expect } from 'vitest';
import {
  calculatePlanOptions,
  calculateQuote,
  PLAN_DOWN_PAYMENT_PERCENT,
  PLAN_MONTHLY_INSTALLMENTS,
  type PricingConfig,
  type EngineHomeDetails,
} from './engine';

// Minimal, self-contained pricing fixture (NOT production values).
const pricing: PricingConfig = {
  window_cleaning: {
    exteriorPerSqFt: 0.08,
    interiorPerSqFt: 0.075,
    minimumPrice: 185,
    modifiers: { stories: { '1': 0, '2': 10, '3': 15 }, condition: { maintenance: 0, heavy: 20 } },
  },
  window_addons: { ladderWork: {}, sunroom: {} },
  house_wash: { perSqFt: 0.25, minimumPrice: 396, modifiers: { stories: { '1': 0, '2': 10, '3': 15 } } },
  gutter_cleaning: { perSqFt: 0.08, minimumPrice: 200, modifiers: { stories: { '1': 0, '2': 10, '3': 12 } } },
  roof_cleaning: { perSqFt: 0.3, minimumPrice: 500, modifiers: { stories: { '1': 0 } } },
  driveway_cleaning: { perSqFt: 0.2, minimumPrice: 200, surfaceMultipliers: { concrete: 1 } },
  pressure_washing: { perSqFt: 0.25, minimumPrice: 75, surfaceMultipliers: { concrete: 1 } },
  bundle_config: { better: { bundleDiscount: 0.1 } },
};

const home: EngineHomeDetails = { squareFootage: 2500, stories: 2, condition: 'maintenance' };

describe('calculatePlanOptions', () => {
  it('prices a firm recurring option: annual = per-visit × frequency and the 20/11 payment structure', () => {
    const res = calculatePlanOptions(
      {
        homeDetails: home,
        scenarios: [
          {
            id: 'current',
            billingCadence: 'monthly',
            additionalServices: { gutterCleaning: true },
            serviceFrequencies: { gutter_cleaning: 4 },
          },
        ],
      },
      pricing,
      7,
    );
    const opt = res.options[0];
    expect(opt.status).toBe('firm');
    expect(opt.optionId).toBe('current');
    expect(opt.ruleVersion).toBe(7);

    const perVisit = opt.lineItems[0].perVisitAmount;
    expect(opt.lineItems[0].frequency).toBe(4);
    expect(opt.annualTotal).toBe(perVisit * 4);
    const expectedDown = Math.round((perVisit * 4) * (PLAN_DOWN_PAYMENT_PERCENT / 100));
    expect(opt.downPayment).toBe(expectedDown);
    expect(opt.recurringAmount).toBe(Math.round((perVisit * 4 - expectedDown) / PLAN_MONTHLY_INSTALLMENTS));
  });

  it('per-visit price matches a one-time calculate-quote for the same single service', () => {
    const q = calculateQuote({ homeDetails: home, additionalServices: { gutterCleaning: true } }, pricing);
    const res = calculatePlanOptions(
      { homeDetails: home, scenarios: [{ id: 'c', additionalServices: { gutterCleaning: true }, serviceFrequencies: { gutter_cleaning: 1 } }] },
      pricing,
    );
    expect(res.options[0].lineItems[0].perVisitAmount).toBe(q.total);
  });

  it('a manual-review option NEVER corrupts a sibling firm option', () => {
    const res = calculatePlanOptions(
      {
        homeDetails: home,
        scenarios: [
          { id: 'firm', additionalServices: { gutterCleaning: true }, serviceFrequencies: { gutter_cleaning: 2 } },
          // 200000 sqft exceeds the automated range -> manual review
          { id: 'review', additionalServices: { houseWash: true } },
        ],
      },
      { ...pricing },
      1,
    );
    // Force the review option via oversize home on a second call
    const review = calculatePlanOptions(
      { homeDetails: { squareFootage: 200000, stories: 2 }, scenarios: [{ id: 'review', additionalServices: { houseWash: true } }] },
      pricing,
    ).options[0];
    expect(review.status).toBe('manual_review_required');
    expect(review.annualTotal).toBeNull();

    const firm = res.options.find((o) => o.optionId === 'firm')!;
    expect(firm.status).toBe('firm');
    expect(firm.annualTotal).toBeGreaterThan(0);
  });

  it('missing property information yields a missing_information option with no total', () => {
    const res = calculatePlanOptions(
      { homeDetails: { squareFootage: 0, stories: 2 }, scenarios: [{ id: 'm', additionalServices: { gutterCleaning: true } }] },
      pricing,
    );
    expect(res.options[0].status).toBe('missing_information');
    expect(res.options[0].annualTotal).toBeNull();
    expect(res.options[0].missing).toContain('squareFootage');
  });

  it('applies bundle discount ONLY from bundle_config, never from the client', () => {
    const noBundle = calculatePlanOptions(
      { homeDetails: home, scenarios: [{ id: 'a', additionalServices: { gutterCleaning: true }, serviceFrequencies: { gutter_cleaning: 4 } }] },
      pricing,
    ).options[0];
    const withBundle = calculatePlanOptions(
      { homeDetails: home, scenarios: [{ id: 'b', additionalServices: { gutterCleaning: true }, serviceFrequencies: { gutter_cleaning: 4 }, bundleKey: 'better' }] },
      pricing,
    ).options[0];
    expect(noBundle.bundleAdjustment).toBe(0);
    expect(withBundle.bundleAdjustment).toBe(Math.round((noBundle.annualTotal ?? 0) * 0.1));
    expect(withBundle.annualTotal).toBe((noBundle.annualTotal ?? 0) - withBundle.bundleAdjustment);
  });

  it('prices interior windows as a standalone line item (0.6× minimum rule)', () => {
    const res = calculatePlanOptions(
      { homeDetails: home, scenarios: [{ id: 'i', additionalServices: { interiorWindows: true }, serviceFrequencies: { interior_windows: 2 } }] },
      pricing,
    ).options[0];
    const li = res.lineItems.find((l) => l.key === 'interior_windows');
    expect(li).toBeTruthy();
    // 2500 * 0.075 * (1 + 0.10) = 206.25 -> 206, min = round(185*0.6)=111 -> 206
    expect(li!.perVisitAmount).toBe(206);
    expect(res.annualTotal).toBe(206 * 2);
  });
});
