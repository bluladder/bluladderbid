import { describe, expect, it } from "vitest";
import { evaluateQuoteIntake, normalizeWindowCleaningSides, windowSidesToPricingType } from "./quoteIntakeContract";

const missing = (values: Record<string, unknown>) => evaluateQuoteIntake(values).requiredToPrice;
describe("canonical quote intake service matrix", () => {
  it.each([
    ["solar only", { services:["solarPanelCleaning"] }, ["solarPanelCount"]],
    ["screen only", { services:["screenRepair"] }, ["screenRepairCount"]],
    ["driveway", { services:["drivewayCleaning"] }, ["drivewaySqft","drivewaySurface"]],
    ["house wash", { services:["houseWash"] }, ["squareFootage","stories"]],
    ["gutter base", { services:["gutterCleaning"] }, ["squareFootage","stories"]],
    ["roof base", { services:["roofCleaning"] }, ["squareFootage","stories"]],
    ["partial", { services:["windowCleaning"], windowCleaningScope:"partial" }, ["windowCleaningSides","windowCount"]],
    ["promotion", { services:["windowCleaning"], promotionId:"promo-99" }, ["windowCount"]],
    ["multi service", { services:["drivewayCleaning","screenRepair"] }, ["drivewaySqft","drivewaySurface","screenRepairCount"]],
  ])("%s has service-specific requirements", (_name, values, expected) => {
    expect(missing(values as Record<string, unknown>).sort()).toEqual(expected.sort());
    if (_name !== "house wash" && _name !== "gutter base" && _name !== "roof base") expect(missing(values as Record<string, unknown>)).not.toContain("squareFootage");
  });

  it("requires valid pressure-washing area details", () => {
    expect(missing({services:["pressureWashing"]})).toEqual(["pressureWashingSurface", "pressureWashingAreas"]);
    expect(missing({services:["pressureWashing"], pressureWashSurface:"concrete", pressureWashingAreas:{frontPorch:{enabled:true,sqft:80}}})).toEqual([]);
  });

  it("requires modifier quantities only after the modifier is selected", () => {
    const base = { services:["windowCleaning"], windowCleaningScope:"whole_home", windowCleaningSides:"outside_only", squareFootage:2000, stories:1, condition:"maintenance" };
    expect(missing(base)).toEqual([]);
    expect(missing({ ...base, hardWaterStains:true })).toContain("hardWaterPercent");
    expect(missing({ ...base, ladderWork:true })).toContain("ladderWorkCount");
  });

  it("requires gutter quantities only for selected add-ons", () => {
    const base = {services:["gutterCleaning"], squareFootage:2000, stories:2};
    expect(missing(base)).toEqual([]);
    expect(missing({...base, gutterAddons:{undergroundDrains:{enabled:true}}})).toContain("gutterUndergroundDrains");
    expect(missing({...base, gutterAddons:{gutterGuards:{enabled:true}}})).toContain("gutterGuardsLinearFeet");
  });

  it("keeps commercial outside residential pricing", () => {
    const result = evaluateQuoteIntake({services:["windowCleaning"], customerType:"commercial", windowCleaningScope:"commercial_custom"});
    expect(result.services).toEqual(["commercial_window_bid"]);
    expect(result.requiredToPrice).toEqual([]);
    expect(result.productPolicyRequired).toContain("commercialLocations");
    expect(result.manualReview).toContain("commercialPricingPolicy");
  });

  it("keeps partial-window requests out of whole-home pricing", () => {
    const result = evaluateQuoteIntake({services:["windowCleaning"], windowCleaningScope:"partial", windowCleaningSides:"outside_only", windowCount:6});
    expect(result.requiredToPrice).toEqual([]);
    expect(result.manualReview).toContain("partialWindowPricingPolicy");
    expect(result.requiredToPrice).not.toContain("squareFootage");
  });
});

describe("canonical window vocabulary", () => {
  it.each([["exterior","outside_only"],["both","inside_and_outside"],["outside_only","outside_only"],["inside_and_outside","inside_and_outside"]])("maps %s", (legacy, canonical) => {
    expect(normalizeWindowCleaningSides(legacy)).toBe(canonical);
  });
  it("never defaults a missing value", () => {
    expect(normalizeWindowCleaningSides(undefined)).toBeNull();
    expect(windowSidesToPricingType(undefined)).toBeNull();
  });
});
