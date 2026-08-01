import { describe, expect, it } from "vitest";
import {
  calculateQuote,
  CONFIRMED_QUOTE_RULES,
  QUOTE_CALCULATION_ORDER,
  QUOTE_RULE_IDS,
  type EngineAdditionalServices,
  type EngineHomeDetails,
  type QuoteInput,
} from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";

function calc(home: Partial<EngineHomeDetails>, services: EngineAdditionalServices) {
  return calculateQuote({ homeDetails: baseHome(home), additionalServices: services } as QuoteInput, LIVE_CONFIG, 2);
}

function windows(home: Partial<EngineHomeDetails> = {}) {
  return calc(home, { ...noServices(), windowCleaning: true });
}

function gutters(gutterAddons: EngineAdditionalServices["gutterAddons"]) {
  return calc({}, { ...noServices(), gutterCleaning: true, gutterAddons });
}

describe("Phase 0 amendment — screen profile", () => {
  it("applies the 5% no-screen discount only to explicitly confirmed window cleaning and discloses it", () => {
    const result = windows({ squareFootage: 2500, screenProfile: "no_screens", screenProfileProvenance: "captured" });
    expect(result.subtotal).toBe(200);
    expect(result.priceAdjustments).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.noScreenDiscount, amount: 10 }));
    expect(result.total).toBe(190);
    expect(result.disclosures?.map((item) => item.text)).toContain(
      "This quote includes a 5% no-screen discount. If removable screens are present when we arrive, the discount will be removed before work begins.",
    );
  });

  it.each(["defaulted", "derived", "unanswered", "unknown"] as const)("does not treat %s as explicit confirmation", (provenance) => {
    const result = windows({ squareFootage: 2500, screenProfile: "no_screens", screenProfileProvenance: provenance });
    expect(result.priceAdjustments).not.toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.noScreenDiscount }));
    expect(result.total).toBe(200);
  });

  it("does not discount standard removable screens", () => {
    const result = windows({ squareFootage: 2500, screenProfile: "standard_removable", screenProfileProvenance: "verified" });
    expect(result.priceAdjustments).toEqual([]);
    expect(result.total).toBe(200);
  });

  it("limits the no-screen discount to the window-cleaning subtotal in a multi-service quote", () => {
    const result = calc({ squareFootage: 2500, screenProfile: "no_screens", screenProfileProvenance: "verified" }, {
      ...noServices(), windowCleaning: true, houseWash: true,
    });
    expect(result.priceAdjustments?.find((item) => item.key === QUOTE_RULE_IDS.noScreenDiscount)?.amount).toBe(10);
    expect(result.priceAdjustments?.find((item) => item.key === QUOTE_RULE_IDS.houseWashWindowBundle)?.amount).toBe(50);
    expect(result.total).toBe(765); // windows 200 + house 625 - 10 - 50
  });
});

describe("Phase 0 amendment — solar screens", () => {
  it("adds 50% to exterior-only window cleaning without an interior component", () => {
    const result = windows({
      squareFootage: 2500,
      screenProfile: "solar",
      solarScreenCoverage: "all",
      solarScreenServiceRequested: true,
      windowCleaningType: "exterior",
    });
    const windowLine = result.lineItems.find((item) => item.key === "window_cleaning")!;
    expect(windowLine.components?.interiorWindows).toBe(0);
    expect(windowLine.components?.canonicalSolarScreenAdjustment).toBe(100);
    expect(windowLine.amount).toBe(300);
    expect(result.priceAdjustments).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.solarScreenService, kind: "surcharge", amount: 100 }));
  });

  it("adds 25% to the total window-cleaning price for full service", () => {
    const result = windows({
      squareFootage: 3000,
      screenProfile: "solar",
      solarScreenCoverage: "all",
      solarScreenServiceRequested: true,
      windowCleaningType: "both",
    });
    const windowLine = result.lineItems.find((item) => item.key === "window_cleaning")!;
    expect(windowLine.components?.exteriorWindows).toBe(240);
    expect(windowLine.components?.interiorWindows).toBe(225);
    expect(windowLine.components?.canonicalSolarScreenAdjustment).toBe(116);
    expect(windowLine.amount).toBe(581);
  });

  it("never applies the exterior solar-screen surcharge to standalone interior cleaning", () => {
    const result = calc({
      squareFootage: 3000,
      screenProfile: "solar",
      solarScreenCoverage: "all",
      solarScreenServiceRequested: true,
    }, { ...noServices(), interiorWindows: true });
    expect(result.lineItems.find((item) => item.key === "interior_windows")?.amount).toBe(225);
    expect(result.priceAdjustments).not.toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.solarScreenService }));
  });

  it("routes partial solar-screen service to clarification instead of a whole-house surcharge", () => {
    const result = windows({
      squareFootage: 2500,
      screenProfile: "mixed_standard_solar",
      solarScreenCoverage: "some",
      solarScreenAffectedWindowCount: 4,
      solarScreenServiceRequested: true,
    });
    expect(result.status).toBe("manual_review_required");
    expect(result.lineItems.find((item) => item.key === "window_cleaning")?.amount).toBe(200);
    expect(result.lineItems.find((item) => item.key === "window_cleaning")?.adjustments).not.toContainEqual(
      expect.objectContaining({ key: QUOTE_RULE_IDS.solarScreenService }),
    );
  });

  it("requests the affected count before reviewing partial solar-screen service", () => {
    const result = windows({
      squareFootage: 2500,
      screenProfile: "solar",
      solarScreenCoverage: "some",
      solarScreenServiceRequested: true,
    });
    expect(result.status).toBe("missing_information");
    expect(result.missing).toContain("solarScreenAffectedWindowCount");
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: "window_cleaning", amount: 200 }));
  });
});

describe("Phase 0 amendment — enclosed patios", () => {
  it("prices one screened enclosure at a flat $150", () => {
    const result = windows({ squareFootage: 2500, enclosedPatioProfile: "screened", screenedEnclosureSoftWash: true });
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: QUOTE_RULE_IDS.screenedEnclosureSoftWash, amount: 150 }));
    expect(result.total).toBe(350);
  });

  it.each([
    ["outside_only", 10, 40],
    ["inside_and_outside", 20, 80],
  ] as const)("prices enclosure windows for %s at the confirmed unit rate", (sides, unitPrice, subtotal) => {
    const result = windows({ squareFootage: 2500, enclosedPatioProfile: "window_enclosed", enclosureWindowCount: 4, enclosureWindowSides: sides });
    expect(result.lineItems).toContainEqual(expect.objectContaining({
      key: QUOTE_RULE_IDS.enclosureWindowCleaning,
      quantity: 4,
      amount: subtotal,
      components: expect.objectContaining({ enclosureWindowUnitPrice: unitPrice }),
    }));
    expect(result.explanation).toContain(`4 enclosure windows × $${unitPrice} each = $${subtotal}`);
  });

  it("does not guess a mixed or uncertain enclosure", () => {
    const result = windows({ squareFootage: 2500, enclosedPatioProfile: "mixed_or_uncertain" });
    expect(result.status).toBe("manual_review_required");
    expect(result.lineItems.some((item) => item.key === QUOTE_RULE_IDS.screenedEnclosureSoftWash || item.key === QUOTE_RULE_IDS.enclosureWindowCleaning)).toBe(false);
  });
});

describe("Phase 0 amendment — gutter add-ons", () => {
  it.each([
    [0, 0],
    [1, 100],
    [2, 100],
    [3, 125],
    [4, 150],
  ])("prices %i underground drains at $%i", (count, addonPrice) => {
    const result = gutters({ undergroundDrains: { enabled: true, count } });
    const addon = result.lineItems.find((item) => item.key === QUOTE_RULE_IDS.undergroundDrainClearing);
    expect(addon?.amount ?? 0).toBe(addonPrice);
    expect(result.total).toBe(200 + addonPrice);
  });

  it("requests an exact drain count without suppressing the base gutter quote", () => {
    const result = gutters({ undergroundDrains: { enabled: true } });
    expect(result.status).toBe("missing_information");
    expect(result.missing).toContain("gutterUndergroundDrainCount");
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: "gutter_cleaning", amount: 200 }));
    expect(result.lineItems.some((item) => item.key === QUOTE_RULE_IDS.undergroundDrainClearing)).toBe(false);
  });

  it("applies one 30% repair adjustment for one or several qualifying repairs", () => {
    const one = gutters({ repairNeeds: ["leaking_seams"] });
    const several = gutters({ repairNeeds: ["leaking_seams", "loose_downspouts", "detached_gutter_sections"] });
    for (const result of [one, several]) {
      expect(result.lineItems.filter((item) => item.key === QUOTE_RULE_IDS.minorGutterRepairs)).toHaveLength(1);
      expect(result.lineItems.find((item) => item.key === QUOTE_RULE_IDS.minorGutterRepairs)?.amount).toBe(60);
      expect(result.total).toBe(260);
    }
  });

  it("excludes underground drains from the 30% repair multiplier", () => {
    const result = gutters({
      undergroundDrains: { enabled: true, count: 3 },
      repairNeeds: ["loose_gutter_sections"],
    });
    expect(result.lineItems.find((item) => item.key === QUOTE_RULE_IDS.undergroundDrainClearing)?.amount).toBe(125);
    expect(result.lineItems.find((item) => item.key === QUOTE_RULE_IDS.minorGutterRepairs)?.amount).toBe(60);
    expect(result.total).toBe(385);
  });

  it.each(["unsure", "another_repair_need"] as const)("keeps base gutter cleaning priced when repair scope is %s", (need) => {
    const result = gutters({ repairNeeds: [need] });
    expect(result.status).toBe("manual_review_required");
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: "gutter_cleaning", amount: 200 }));
    expect(result.lineItems.some((item) => item.key === QUOTE_RULE_IDS.minorGutterRepairs)).toBe(false);
  });

  it("does not fabricate a repair price for an unrecognized major-repair description", () => {
    const result = gutters({ repairNeeds: ["replace_long_gutter_section" as never] });
    expect(result.status).toBe("manual_review_required");
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: "gutter_cleaning", amount: 200 }));
    expect(result.lineItems.some((item) => item.key === QUOTE_RULE_IDS.minorGutterRepairs)).toBe(false);
  });
});

describe("Phase 0 amendment — house-wash patios and bundle", () => {
  it.each([
    [{ frontSelected: true }, 50],
    [{ backSelected: true }, 50],
    [{ frontSelected: true, backSelected: true }, 100],
  ])("uses the simple 10%% per-patio method", (selection, addonTotal) => {
    const result = calc({}, {
      ...noServices(),
      houseWash: true,
      houseWashPatios: { pricingMethod: "simple_selection", ...selection },
    });
    const patios = result.lineItems.filter((item) => item.key === QUOTE_RULE_IDS.houseWashFrontPatio || item.key === QUOTE_RULE_IDS.houseWashBackPatio);
    expect(patios.reduce((sum, item) => sum + item.amount, 0)).toBe(addonTotal);
    expect(result.total).toBe(500 + addonTotal);
  });

  it("uses exact square footage at $0.25 instead of the percentage method", () => {
    const result = calc({}, {
      ...noServices(),
      houseWash: true,
      houseWashPatios: {
        pricingMethod: "exact_square_footage",
        frontSelected: true,
        backSelected: true,
        frontSqft: 100,
        backSqft: 200,
      },
    });
    const patios = result.lineItems.filter((item) => item.key === QUOTE_RULE_IDS.houseWashFrontPatio || item.key === QUOTE_RULE_IDS.houseWashBackPatio);
    expect(patios.reduce((sum, item) => sum + item.amount, 0)).toBe(75);
    expect(result.total).toBe(575);
  });

  it("does not double-charge supplied sqft when the simple method is selected", () => {
    const result = calc({}, {
      ...noServices(),
      houseWash: true,
      houseWashPatios: { pricingMethod: "simple_selection", frontSelected: true, frontSqft: 1000 },
    });
    expect(result.lineItems.find((item) => item.key === QUOTE_RULE_IDS.houseWashFrontPatio)?.amount).toBe(50);
    expect(result.total).toBe(550);
  });

  it("keeps base house washing priced when selected exact patio area is invalid", () => {
    const result = calc({}, {
      ...noServices(),
      houseWash: true,
      houseWashPatios: { pricingMethod: "exact_square_footage", frontSelected: true, frontSqft: 0 },
    });
    expect(result.status).toBe("missing_information");
    expect(result.missing).toContain("houseWashFrontPatioSqft");
    expect(result.lineItems).toContainEqual(expect.objectContaining({ key: "house_wash", amount: 500 }));
  });

  it("applies the stable $50 house-wash/window bundle once", () => {
    const result = calc({}, { ...noServices(), windowCleaning: true, houseWash: true });
    expect(result.priceAdjustments?.filter((item) => item.key === QUOTE_RULE_IDS.houseWashWindowBundle)).toEqual([
      expect.objectContaining({ amount: 50 }),
    ]);
    expect(result.total).toBe(635);
    expect(result.explanation).toContain("House wash + window cleaning bundle -$50");
  });

  it("keeps every discount bounded at zero", () => {
    const result = calculateQuote({
      homeDetails: baseHome({ squareFootage: 1000, screenProfile: "no_screens", screenProfileProvenance: "captured" }),
      additionalServices: { ...noServices(), windowCleaning: true },
      discount: { type: "fixed", value: 10_000, code: "LARGE" },
    }, LIVE_CONFIG, 2);
    expect(result.total).toBe(0);
    expect(result.discount?.amount).toBeLessThanOrEqual(result.subtotal);
  });

  it("publishes the deterministic calculation order and confirmed constants", () => {
    expect(QUOTE_CALCULATION_ORDER).toEqual([
      "base_service_prices",
      "count_or_measurement_addons",
      "service_specific_percentage_adjustments",
      "fixed_bundle_discounts",
      "other_authorized_promotions",
      "final_total",
    ]);
    expect(CONFIRMED_QUOTE_RULES.minorGutterRepairPercent).toBe(30);
  });
});
