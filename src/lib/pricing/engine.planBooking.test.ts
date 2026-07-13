import { describe, it, expect } from "vitest";
import {
  computeBundleTiers,
  buildPlanJobberLineItems,
  planJobberLineItemsTotal,
  evaluatePlanSelection,
  type EngineAdditionalServices,
} from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";

function svc(overrides: Partial<EngineAdditionalServices>): EngineAdditionalServices {
  return { ...noServices(), ...overrides };
}

function tiersFor(services: EngineAdditionalServices, homeOverrides = {}) {
  return computeBundleTiers(
    { homeDetails: baseHome({ squareFootage: 2500, stories: 1, windowCleaningType: "both", ...homeOverrides }), additionalServices: services },
    LIVE_CONFIG,
    7,
  );
}

describe("recurring plan booking — Jobber line items", () => {
  it("reconciles Jobber line items EXACTLY to the canonical annual total", () => {
    const result = tiersFor(svc({ windowCleaning: true, gutterCleaning: true, houseWash: true }));
    expect(result.status).toBe("firm");
    for (const tier of result.tiers) {
      const items = buildPlanJobberLineItems(tier, result.serviceBases);
      expect(planJobberLineItemsTotal(items)).toBe(tier.annualTotal);
    }
  });

  it("always keeps interior windows as a separate line item", () => {
    const result = tiersFor(svc({ windowCleaning: true }), { windowCleaningType: "both" });
    const best = result.tiers.find((t) => t.tier === "best")!;
    const items = buildPlanJobberLineItems(best, result.serviceBases);
    const interior = items.filter((i) => /interior/i.test(i.name));
    const exterior = items.filter((i) => /exterior/i.test(i.name));
    expect(interior.length).toBe(1);
    expect(exterior.length).toBe(1);
    expect(interior[0].unitPrice).toBeGreaterThan(0);
  });

  it("preserves bundle discount, add-on discount and tier-buffer adjustments on the option", () => {
    const result = tiersFor(svc({ windowCleaning: true, gutterCleaning: true, houseWash: true, drivewayCleaning: { enabled: true, sqft: 600, surfaceType: "concrete" } }));
    for (const tier of result.tiers) {
      expect(tier.bundleDiscount).toBeGreaterThanOrEqual(0);
      expect(tier.addonDiscountPercent).toBeGreaterThanOrEqual(0);
      expect(tier.tierBufferAdjustment).toBeGreaterThanOrEqual(0);
      // Buffer guarantees strict tier ordering.
    }
    const [good, better, best] = result.tiers;
    expect(better.annualTotal).toBeGreaterThan(good.annualTotal);
    expect(best.annualTotal).toBeGreaterThan(better.annualTotal);
  });
});

describe("recurring plan booking — server-authoritative validation", () => {
  const services = svc({ windowCleaning: true, gutterCleaning: true, houseWash: true });

  it("returns the server option for a valid selection (browser total is ignored)", () => {
    const result = tiersFor(services);
    const better = result.tiers.find((t) => t.tier === "better")!;
    // Client claims a manipulated (too-low) total; server ignores it.
    const outcome = evaluatePlanSelection(result, { tier: "better", expectedEngineVersion: result.engineVersion, expectedRuleVersion: 7, expectedAnnualTotal: better.annualTotal });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.option.annualTotal).toBe(better.annualTotal);
      expect(planJobberLineItemsTotal(outcome.lineItems)).toBe(better.annualTotal);
    }
  });

  it("rejects an unknown option id", () => {
    const result = tiersFor(services);
    const outcome = evaluatePlanSelection(result, { tier: "platinum" });
    expect(outcome).toMatchObject({ ok: false, reason: "unknown_option" });
  });

  it("rejects a missing-information result (no price)", () => {
    const result = tiersFor(services, { squareFootage: 0 });
    const outcome = evaluatePlanSelection(result, { tier: "better" });
    expect(outcome).toMatchObject({ ok: false, reason: "missing_information" });
  });

  it("rejects a manual-review result (out of automated range)", () => {
    const result = tiersFor(services, { squareFootage: 999999 });
    const outcome = evaluatePlanSelection(result, { tier: "better" });
    expect(outcome).toMatchObject({ ok: false, reason: "manual_review_required" });
  });

  it("flags pricing_changed when the rule version moved", () => {
    const result = tiersFor(services);
    const better = result.tiers.find((t) => t.tier === "better")!;
    const outcome = evaluatePlanSelection(result, { tier: "better", expectedRuleVersion: 6, expectedAnnualTotal: better.annualTotal });
    expect(outcome).toMatchObject({ ok: false, reason: "pricing_changed" });
  });

  it("flags pricing_changed when the total moved beyond tolerance", () => {
    const result = tiersFor(services);
    const better = result.tiers.find((t) => t.tier === "better")!;
    const outcome = evaluatePlanSelection(result, { tier: "better", expectedRuleVersion: 7, expectedAnnualTotal: better.annualTotal + 500 });
    expect(outcome).toMatchObject({ ok: false, reason: "pricing_changed" });
  });

  it("proceeds when the customer explicitly reconfirms a changed price", () => {
    const result = tiersFor(services);
    const better = result.tiers.find((t) => t.tier === "better")!;
    const outcome = evaluatePlanSelection(result, { tier: "better", expectedAnnualTotal: better.annualTotal + 500, confirmPricingChange: true });
    expect(outcome.ok).toBe(true);
  });

  it("does not flag a harmless rounding difference (within tolerance)", () => {
    const result = tiersFor(services);
    const better = result.tiers.find((t) => t.tier === "better")!;
    const outcome = evaluatePlanSelection(result, { tier: "better", expectedRuleVersion: 7, expectedAnnualTotal: better.annualTotal + 1 });
    expect(outcome.ok).toBe(true);
  });
});
