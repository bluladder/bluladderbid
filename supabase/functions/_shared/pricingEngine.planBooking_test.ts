// Deno tests for the recurring-plan booking helpers (server engine).
// Run with: deno test supabase/functions/_shared/pricingEngine.planBooking_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeBundleTiers,
  buildPlanJobberLineItems,
  planJobberLineItemsTotal,
  evaluatePlanSelection,
  type PricingConfig,
  type EngineHomeDetails,
  type EngineAdditionalServices,
} from "./pricingEngine.ts";

const CONFIG: PricingConfig = {
  window_cleaning: {
    exteriorPerSqFt: 0.08,
    interiorPerSqFt: 0.075,
    minimumPrice: 185,
    modifiers: { stories: { "1": 0, "2": 12, "3": 18 }, condition: { heavy: 15, maintenance: 0 } },
  },
  window_addons: { ladderWork: {}, sunroom: {} },
  house_wash: { perSqFt: 0.25, minimumPrice: 396, modifiers: { stories: { "1": 0, "2": 10, "3": 15 } }, rustStainSurcharge: 15 },
  gutter_cleaning: { perSqFt: 0.08, minimumPrice: 200, modifiers: { stories: { "1": 0, "2": 10, "3": 12 } } },
  roof_cleaning: { perSqFt: 0.3, minimumPrice: 500, modifiers: { stories: { "1": 0, "2": 10, "3": 15 }, roofType: {}, severity: {} } },
  driveway_cleaning: { perSqFt: 0.2, minimumPrice: 200, surfaceMultipliers: { concrete: 1 } },
  pressure_washing: { perSqFt: 0.25, minimumPrice: 75, surfaceMultipliers: { concrete: 1 } },
  bundle_config: {
    good: { name: "Good", label: "Essential", exteriorWindowFrequency: 2, interiorWindowFrequency: 0, additionalServicesFrequency: 1, bundleDiscount: 0.05, addonDiscount: 0.05, includedServices: ["gutter_cleaning"] },
    better: { name: "Better", label: "Popular", exteriorWindowFrequency: 3, interiorWindowFrequency: 1, additionalServicesFrequency: 2, bundleDiscount: 0.1, addonDiscount: 0.1, includedServices: ["gutter_cleaning", "house_wash"] },
    best: { name: "Best", label: "Total", exteriorWindowFrequency: 4, interiorWindowFrequency: 2, additionalServicesFrequency: 2, bundleDiscount: 0.15, addonDiscount: 0.15, includedServices: ["gutter_cleaning", "house_wash"] },
  },
  bundle_rules: { minimumTierBuffer: 25, tierOrder: ["good", "better", "best"], planDownPaymentPercent: 20, planMonthlyInstallments: 11, roofBaseIncludedTiers: ["best"] },
} as unknown as PricingConfig;

function home(overrides: Partial<EngineHomeDetails> = {}): EngineHomeDetails {
  return { squareFootage: 2500, stories: 1, windowCleaningType: "both", condition: "maintenance", ...overrides } as EngineHomeDetails;
}
function services(overrides: Partial<EngineAdditionalServices> = {}): EngineAdditionalServices {
  return { windowCleaning: true, gutterCleaning: true, houseWash: true, ...overrides } as EngineAdditionalServices;
}
function tiers(homeOverrides = {}, svcOverrides = {}) {
  return computeBundleTiers({ homeDetails: home(homeOverrides), additionalServices: services(svcOverrides) }, CONFIG, 7);
}

Deno.test("Jobber line items reconcile exactly to the annual total", () => {
  const result = tiers();
  assertEquals(result.status, "firm");
  for (const t of result.tiers) {
    const items = buildPlanJobberLineItems(t, result.serviceBases);
    assertEquals(planJobberLineItemsTotal(items), t.annualTotal);
  }
});

Deno.test("interior windows are a separate line item", () => {
  const result = tiers();
  const best = result.tiers.find((t) => t.tier === "best")!;
  const items = buildPlanJobberLineItems(best, result.serviceBases);
  assertEquals(items.filter((i) => /interior/i.test(i.name)).length, 1);
  assertEquals(items.filter((i) => /exterior/i.test(i.name)).length, 1);
});

Deno.test("browser total is ignored; server option is authoritative", () => {
  const result = tiers();
  const better = result.tiers.find((t) => t.tier === "better")!;
  const outcome = evaluatePlanSelection(result, { tier: "better", expectedRuleVersion: 7, expectedAnnualTotal: better.annualTotal });
  assert(outcome.ok);
  if (outcome.ok) assertEquals(outcome.option.annualTotal, better.annualTotal);
});

Deno.test("unknown option is rejected", () => {
  const outcome = evaluatePlanSelection(tiers(), { tier: "diamond" });
  assertEquals(outcome.ok, false);
  if (!outcome.ok) assertEquals(outcome.reason, "unknown_option");
});

Deno.test("missing information cannot book", () => {
  const outcome = evaluatePlanSelection(tiers({ squareFootage: 0 }), { tier: "better" });
  assertEquals(outcome.ok, false);
  if (!outcome.ok) assertEquals(outcome.reason, "missing_information");
});

Deno.test("changed rule version requires reconfirmation", () => {
  const result = tiers();
  const better = result.tiers.find((t) => t.tier === "better")!;
  const outcome = evaluatePlanSelection(result, { tier: "better", expectedRuleVersion: 6, expectedAnnualTotal: better.annualTotal });
  assertEquals(outcome.ok, false);
  if (!outcome.ok) assertEquals(outcome.reason, "pricing_changed");
});

Deno.test("explicit reconfirmation proceeds", () => {
  const result = tiers();
  const better = result.tiers.find((t) => t.tier === "better")!;
  const outcome = evaluatePlanSelection(result, { tier: "better", expectedAnnualTotal: better.annualTotal + 400, confirmPricingChange: true });
  assert(outcome.ok);
});
