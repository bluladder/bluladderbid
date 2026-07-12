import { describe, it, expect } from "vitest";
import { computeBundleTiers } from "./engine";
import type { EngineHomeDetails, EngineAdditionalServices } from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";
import { legacyBundles } from "./__fixtures__/legacyBundlePricing";

const DOWN_PCT = 20;
const INSTALLMENTS = 11;

function svc(overrides: Partial<EngineAdditionalServices>): EngineAdditionalServices {
  return { ...noServices(), ...overrides };
}

function pw(front = 0, back = 0, pool = 0, walk = 0, surfaceType = "concrete") {
  return {
    enabled: front + back + pool + walk > 0,
    surfaceType,
    frontPorch: { enabled: front > 0, sqft: front },
    backPatio: { enabled: back > 0, sqft: back },
    poolDeck: { enabled: pool > 0, sqft: pool },
    walkways: { enabled: walk > 0, sqft: walk },
  };
}

interface Scenario {
  name: string;
  home: EngineHomeDetails;
  services: EngineAdditionalServices;
}

const scenarios: Scenario[] = [];
for (const sqft of [1200, 2000, 2500, 4200]) {
  for (const stories of [1, 2, 3]) {
    for (const wct of ["exterior", "both"] as const) {
      // Windows only (exercises the tier buffer for exterior-only cases)
      scenarios.push({
        name: `windows ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true }),
      });
      // Windows + gutter (gutter included in better/best, addon in good)
      scenarios.push({
        name: `windows+gutter ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true, gutterCleaning: true }),
      });
      // Windows + house wash (included in best only)
      scenarios.push({
        name: `windows+housewash ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true, houseWash: true }),
      });
      // Windows + roof (base in best, addon otherwise)
      scenarios.push({
        name: `windows+roof ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true, roofCleaning: true, roofType: "tile", roofSeverity: "moderate" }),
      });
      // Windows + driveway (always addon)
      scenarios.push({
        name: `windows+driveway ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true, drivewayCleaning: { enabled: true, sqft: 600, surfaceType: "pavers" } }),
      });
      // Windows + pressure washing (always addon)
      scenarios.push({
        name: `windows+pressure ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ windowCleaning: true, pressureWashing: pw(200, 300, 0, 150, "stamped") }),
      });
      // Everything
      scenarios.push({
        name: `all-services ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({
          windowCleaning: true,
          gutterCleaning: true,
          houseWash: true,
          roofCleaning: true,
          roofType: "asphalt",
          roofSeverity: "light",
          drivewayCleaning: { enabled: true, sqft: 800, surfaceType: "concrete" },
          pressureWashing: pw(250, 400, 500, 0, "brick"),
        }),
      });
      // Gutter only (no windows) — window cost 0
      scenarios.push({
        name: `gutter-only ${wct} ${sqft}sqft ${stories}st`,
        home: baseHome({ squareFootage: sqft, stories, windowCleaningType: wct }),
        services: svc({ gutterCleaning: true }),
      });
    }
  }
}

describe("computeBundleTiers exact parity with legacy useServicePricing", () => {
  it(`covers ${scenarios.length} representative production scenarios`, () => {
    expect(scenarios.length).toBeGreaterThan(100);
  });

  for (const s of scenarios) {
    it(`parity: ${s.name}`, () => {
      const legacy = legacyBundles(s.home, s.services, LIVE_CONFIG);
      const result = computeBundleTiers(
        { homeDetails: s.home, additionalServices: s.services },
        LIVE_CONFIG,
        7,
      );
      expect(result.status).toBe("firm");
      expect(result.tiers.length).toBe(legacy.length);

      // Tier ordering strictly increasing (good < better < best)
      for (let i = 1; i < result.tiers.length; i++) {
        expect(result.tiers[i].annualTotal).toBeGreaterThan(result.tiers[i - 1].annualTotal);
      }

      for (let i = 0; i < legacy.length; i++) {
        const L = legacy[i];
        const R = result.tiers[i];
        const ctx = `${s.name} / ${L.tier}`;

        expect(R.tier, ctx).toBe(L.tier);
        expect(R.annualTotal, `annualTotal ${ctx}`).toBe(L.annualTotal);
        expect(R.monthlyPayment, `monthlyPayment ${ctx}`).toBe(L.monthlyPayment);
        expect(R.windowCost, `windowCost ${ctx}`).toBe(L.windowCost);
        expect(R.additionalServicesCost, `addlCost ${ctx}`).toBe(L.additionalServicesCost);
        expect(R.addonsCost, `addonsCost ${ctx}`).toBe(L.addonsCost);
        expect(R.bundleDiscount, `bundleDiscount ${ctx}`).toBe(L.bundleDiscount);
        expect(R.savings, `savings ${ctx}`).toBe(L.savings);
        expect(R.savingsPercent, `savingsPercent ${ctx}`).toBe(L.savingsPercent);
        expect(R.addonSavings, `addonSavings ${ctx}`).toBe(L.addonSavings);
        expect(R.windowFrequencyConfig, `windowFreq ${ctx}`).toEqual(L.windowFrequencyConfig);
        expect(R.additionalServicesIncluded, `included ${ctx}`).toEqual(L.additionalServicesIncluded);
        expect(R.baseServices, `baseServices ${ctx}`).toEqual(L.baseServices);
        expect(R.availableAddons, `availableAddons ${ctx}`).toEqual(L.availableAddons);

        // Installment structure parity (20% deposit + 11 payments)
        const expectedDown = Math.round(L.annualTotal * (DOWN_PCT / 100));
        const expectedRecurring = Math.round((L.annualTotal - expectedDown) / INSTALLMENTS);
        expect(R.downPayment, `downPayment ${ctx}`).toBe(expectedDown);
        expect(R.recurringMonthly, `recurringMonthly ${ctx}`).toBe(expectedRecurring);
      }
    });
  }
});

describe("computeBundleTiers guardrail + fail-closed behavior", () => {
  it("returns missing_information (no prices) when square footage is absent", () => {
    const r = computeBundleTiers(
      { homeDetails: baseHome({ squareFootage: 0 }), additionalServices: svc({ windowCleaning: true }) },
      LIVE_CONFIG,
    );
    expect(r.status).toBe("missing_information");
    expect(r.tiers).toHaveLength(0);
    expect(r.missing).toContain("squareFootage");
  });

  it("returns missing_information when no service is selected", () => {
    const r = computeBundleTiers(
      { homeDetails: baseHome(), additionalServices: noServices() },
      LIVE_CONFIG,
    );
    expect(r.status).toBe("missing_information");
    expect(r.tiers).toHaveLength(0);
  });

  it("activates the buffer for exterior-only windows (better/best would otherwise be <= good)", () => {
    const r = computeBundleTiers(
      { homeDetails: baseHome({ squareFootage: 2000, windowCleaningType: "exterior" }), additionalServices: svc({ windowCleaning: true }) },
      LIVE_CONFIG,
    );
    expect(r.status).toBe("firm");
    // Bundle discounts make better/best cheaper than good on windows-only; buffer must fire.
    expect(r.tiers[1].tierBufferAdjustment).toBeGreaterThan(0);
    expect(r.tiers[2].tierBufferAdjustment).toBeGreaterThan(0);
    expect(r.tiers[1].annualTotal).toBe(r.tiers[0].annualTotal + r.minimumTierBuffer);
    expect(r.tiers[2].annualTotal).toBe(r.tiers[1].annualTotal + r.minimumTierBuffer);
  });

  it("does NOT activate the buffer when tiers already increase (all services, both windows)", () => {
    const r = computeBundleTiers(
      {
        homeDetails: baseHome({ squareFootage: 3000, stories: 2, windowCleaningType: "both" }),
        additionalServices: svc({ windowCleaning: true, gutterCleaning: true, houseWash: true }),
      },
      LIVE_CONFIG,
    );
    expect(r.status).toBe("firm");
    expect(r.tiers[1].tierBufferAdjustment).toBe(0);
    expect(r.tiers[2].tierBufferAdjustment).toBe(0);
  });
});
