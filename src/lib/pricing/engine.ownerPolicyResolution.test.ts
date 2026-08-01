import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  isValidWindowEquivalentCount,
  QUOTE_RULE_IDS,
  type EngineAdditionalServices,
  type EngineHomeDetails,
  type QuoteInput,
} from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";

function calc(home: Partial<EngineHomeDetails>, services: EngineAdditionalServices, discount?: QuoteInput["discount"]) {
  return calculateQuote({ homeDetails: baseHome(home), additionalServices: services, discount }, LIVE_CONFIG, 3);
}

function windows(home: Partial<EngineHomeDetails> = {}, discount?: QuoteInput["discount"]) {
  return calc(home, { ...noServices(), windowCleaning: true }, discount);
}

describe("approved whole-home window policy", () => {
  it("uses $0.08 outside-only and $0.15 inside-and-out whole-home rates", () => {
    expect(windows({ squareFootage: 3000, windowCleaningType: "exterior" }).total).toBe(240);
    const both = windows({ squareFootage: 3000, windowCleaningType: "both" });
    expect(both.lineItems.find((line) => line.key === "window_cleaning")?.components).toMatchObject({
      exteriorWindows: 240,
      interiorWindows: 210,
      windowCleaningTotal: 450,
    });
  });

  it("prices added interiors, hard water, and unusual ladder access by 0.5 window equivalents", () => {
    const result = windows({
      squareFootage: 4000,
      addedInteriorWindowSides: 1.5,
      hardWaterStains: true,
      hardWaterAffectedWindowEquivalents: 2.5,
      ladderWork: true,
      ladderAffectedWindowEquivalents: 1.5,
    });
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.addedInteriorWindowSides, amount: 15 }));
    expect(result.lineItems.find((line) => line.key === "window_cleaning")?.components).toMatchObject({
      hardWaterAddon: 25,
      ladderWorkAddon: 7.5,
    });
  });

  it("applies French panes at 50% of the base window service only", () => {
    const result = windows({ squareFootage: 3000, windowCleaningType: "both", frenchPanes: true, hardWaterStains: true, hardWaterAffectedWindowEquivalents: 2 });
    const line = result.lineItems.find((item) => item.key === "window_cleaning")!;
    expect(line.components?.frenchPanesAddon).toBe(225);
    expect(line.components?.hardWaterAddon).toBe(20);
    expect(line.amount).toBe(695);
  });

  it("deducts $8 per explicit omitted side, bounds the deduction at the window minimum, and books an unknown count", () => {
    const exact = windows({ squareFootage: 4000, omittedWindowSides: 2 });
    expect(exact.priceAdjustments).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.omittedWindowSides, amount: 16 }));
    const bounded = windows({ squareFootage: 2000, omittedWindowSides: 10 });
    expect(bounded.priceAdjustments.find((item) => item.key === QUOTE_RULE_IDS.omittedWindowSides)).toBeUndefined();
    expect(bounded.total).toBe(185);
    const unknown = windows({ omittedWindowSides: "unknown" });
    expect(unknown.status).toBe("firm");
    expect(unknown.disclosures?.find((item) => item.key === QUOTE_RULE_IDS.omittedWindowSides)?.text).toContain("$8");
  });

  it("accepts half-equivalents and rejects negative, zero, or impossible increments", () => {
    expect(isValidWindowEquivalentCount(0.5)).toBe(true);
    expect(isValidWindowEquivalentCount(2.5)).toBe(true);
    expect(isValidWindowEquivalentCount(-0.5)).toBe(false);
    expect(isValidWindowEquivalentCount(0)).toBe(false);
    expect(isValidWindowEquivalentCount(1.25)).toBe(false);
    expect(windows({ addedInteriorWindowSides: 1.25 }).missing).toContain("addedInteriorWindowSides");
  });
});

describe("estimated Texas sales tax", () => {
  it("taxes window service at 8.25% and keeps the service total pre-tax", () => {
    const result = windows({ squareFootage: 2500 });
    expect(result).toMatchObject({
      serviceSubtotal: 200,
      taxableSubtotal: 200,
      estimatedTax: 16.5,
      total: 200,
      estimatedTotal: 216.5,
      taxRate: 0.0825,
      taxLabel: "Estimated tax",
    });
  });

  it("exempts base gutter cleaning, underground drains, and minor gutter repairs", () => {
    const result = calc({}, {
      ...noServices(),
      gutterCleaning: true,
      gutterAddons: { undergroundDrains: { enabled: true, count: 3 }, repairNeeds: ["leaking_seams"] },
    });
    expect(result.total).toBe(385);
    expect(result.taxableSubtotal).toBe(0);
    expect(result.estimatedTax).toBe(0);
    expect(result.estimatedTotal).toBe(385);
  });

  it("taxes only taxable lines in a mixed quote and allocates a quote discount before tax", () => {
    const result = calc({ squareFootage: 2500 }, { ...noServices(), windowCleaning: true, gutterCleaning: true }, { type: "fixed", value: 40 });
    expect(result.serviceSubtotal).toBe(400);
    expect(result.total).toBe(360);
    expect(result.taxableSubtotal).toBe(180);
    expect(result.estimatedTax).toBe(14.85);
    expect(result.estimatedTotal).toBe(374.85);
  });
});

describe("authoritative duration and scoped review", () => {
  it("uses pre-discount work value, ignores tax, and adds setup once", () => {
    const undiscounted = windows({ squareFootage: 2500 });
    const discounted = windows({ squareFootage: 2500 }, { type: "fixed", value: 100 });
    expect(undiscounted.estimatedDurationMinutes).toBe(120);
    expect(discounted.estimatedDurationMinutes).toBe(120);
    expect(discounted.estimatedTax).not.toBe(undiscounted.estimatedTax);
  });

  it("aggregates multi-service work and rounds up to 15 minutes", () => {
    const result = calc({ squareFootage: 2500 }, { ...noServices(), windowCleaning: true, gutterCleaning: true });
    expect(result.estimatedDurationMinutes).toBe(195);
    expect(result.durationSource).toBe("deterministic_duration_engine");
  });

  it("keeps an independently firm service bookable when roof washing needs review", () => {
    const result = calc({ squareFootage: 2500 }, {
      ...noServices(),
      windowCleaning: true,
      roofCleaning: true,
      roofType: "tile",
      roofSeverity: "light",
      roofRiskFlags: { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false },
    });
    expect(result.status).toBe("manual_review_required");
    expect(result.manualReviewServiceKeys).toContain("roof_cleaning");
    expect(result.bookableServiceKeys).toContain("window_cleaning");
    expect(result.estimatedDurationMinutes).toBeGreaterThan(0);
    expect(result.lineItems.some((line) => line.key === "roof_cleaning")).toBe(false);
  });

  it("does not invent duration for a manual-review-only service", () => {
    const result = calc({}, {
      ...noServices(),
      roofCleaning: true,
      roofType: "metal",
      roofSeverity: "moderate",
      roofRiskFlags: { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false },
    });
    expect(result.bookableServiceKeys).toEqual([]);
    expect(result.estimatedDurationMinutes).toBeNull();
  });
});

describe("firm/review service boundaries", () => {
  it("allows ordinary asphalt roof wash and reviews three-story or risk-flagged roofs", () => {
    const firm = calc({}, { ...noServices(), roofCleaning: true, roofType: "asphalt_shingle", roofSeverity: "moderate", roofRiskFlags: { knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false } });
    expect(firm.status).toBe("firm");
    const review = calc({ stories: 3 }, { ...noServices(), roofCleaning: true, roofType: "asphalt", roofSeverity: "light", roofRiskFlags: { knownDamage: false, extremePitch: true, fragileMaterial: false, unusualAccess: false } });
    expect(review.manualReviewServiceKeys).toContain("roof_cleaning");
  });

  it("allows standard one/two-story solar access and reusable-frame screen repair, reviewing exceptions only", () => {
    const solar = calc({}, { ...noServices(), solarPanelCleaning: { enabled: true, panelCount: 20, stories: 2, accessType: "standard_residential", knownDamage: false, extremePitch: false, fragileMaterial: false, unusualAccess: false } });
    expect(solar.status).toBe("firm");
    const screen = calc({}, { ...noServices(), screenRepair: { enabled: true, screenCount: 3, scopeType: "standard_removable_reusable_frame" } });
    expect(screen.status).toBe("firm");
    const specialty = calc({}, { ...noServices(), screenRepair: { enabled: true, screenCount: 3, scopeType: "screen_door" } });
    expect(specialty.manualReviewServiceKeys).toContain("screen_repair");
  });

  it("reviews an unknown driveway surface without blocking a firm window service", () => {
    const result = calc({ squareFootage: 2500 }, { ...noServices(), windowCleaning: true, drivewayCleaning: { enabled: true, sqft: 400, surfaceType: "unknown" } });
    expect(result.manualReviewServiceKeys).toContain("driveway_cleaning");
    expect(result.bookableServiceKeys).toContain("window_cleaning");
  });
});

describe("$99 promotion extension", () => {
  it("prices half-window increments over ten and keeps modifiers separate", () => {
    const result = calculateQuote({
      homeDetails: baseHome({ hardWaterStains: true, hardWaterAffectedWindowEquivalents: 1.5 }),
      additionalServices: noServices(),
      promotion: { id: "PROMO_99_WINDOWS", windowCount: 12.5 },
    }, LIVE_CONFIG, 3);
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.promotionAdditionalWindows, quantity: 2.5, amount: 25 }));
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.hardWaterRemoval, amount: 15 }));
    expect(result.total).toBe(139);
    expect(result.taxableSubtotal).toBe(139);
  });
});
