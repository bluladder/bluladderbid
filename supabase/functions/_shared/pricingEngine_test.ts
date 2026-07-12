// Deno test for the server copy of the canonical pricing engine.
// Run with: deno test supabase/functions/_shared/pricingEngine_test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calculateQuote, type PricingConfig, type QuoteInput } from "./pricingEngine.ts";

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
};

function base(): QuoteInput {
  return {
    homeDetails: { squareFootage: 2000, stories: 1, windowCleaningType: "exterior", condition: "maintenance" },
    additionalServices: {},
    discount: null,
  };
}

Deno.test("firm house wash uses live per-sqft", () => {
  const input = base();
  input.additionalServices = { houseWash: true };
  const r = calculateQuote(input, CONFIG, 1);
  assertEquals(r.status, "firm");
  assertEquals(r.total, 500);
});

Deno.test("missing sqft fails safe", () => {
  const input = base();
  input.homeDetails.squareFootage = NaN;
  input.additionalServices = { windowCleaning: true };
  const r = calculateQuote(input, CONFIG, 1);
  assertEquals(r.status, "missing_information");
  assertEquals(r.total, 0);
});

Deno.test("missing config -> manual review, no guessed price", () => {
  const input = base();
  input.additionalServices = { houseWash: true };
  const broken = { ...CONFIG, house_wash: undefined } as unknown as PricingConfig;
  const r = calculateQuote(input, broken, 1);
  assertEquals(r.status, "manual_review_required");
  assertEquals(r.total, 0);
});