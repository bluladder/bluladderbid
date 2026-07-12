import { describe, it, expect } from "vitest";
import { calculateQuote, type QuoteInput, type PricingConfig } from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";

const PROMO_ID = "PROMO_99_WINDOWS";

function calc(input: Partial<QuoteInput>, config: PricingConfig = LIVE_CONFIG) {
  return calculateQuote(
    {
      homeDetails: input.homeDetails ?? baseHome(),
      additionalServices: input.additionalServices ?? noServices(),
      discount: input.discount ?? null,
      promotion: input.promotion ?? null,
    },
    config,
    1,
  );
}

describe("$99 window promotion", () => {
  it("does NOT apply automatically (no promotion field => normal pricing)", () => {
    const r = calc({ additionalServices: { ...noServices(), windowCleaning: true } });
    expect(r.promotion).toBeNull();
    // Normal window minimum price applies, not $99.
    expect(r.total).not.toBe(99);
  });

  it("calculates $99 only when explicitly selected with a valid id and count", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 8 } });
    expect(r.status).toBe("firm");
    expect(r.total).toBe(99);
    expect(r.promotion?.id).toBe(PROMO_ID);
    expect(r.promotion?.windowCount).toBe(8);
    expect(r.promotion?.version).toBe(1);
  });

  it("allows exactly the maximum window count", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 10 } });
    expect(r.status).toBe("firm");
    expect(r.total).toBe(99);
  });

  it("does NOT silently remain $99 for more than 10 windows -> manual review", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 11 } });
    expect(r.status).toBe("manual_review_required");
    expect(r.total).not.toBe(99);
    expect(r.promotion).toBeNull();
  });

  it("rejects an unknown promotion identifier", () => {
    const r = calc({ promotion: { id: "NOT_A_REAL_PROMO", windowCount: 5 } });
    expect(r.status).toBe("manual_review_required");
    expect(r.promotion).toBeNull();
  });

  it("rejects an inactive promotion version", () => {
    const inactive: PricingConfig = {
      ...LIVE_CONFIG,
      window_promo_99: { ...LIVE_CONFIG.window_promo_99!, active: false },
    };
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 5 } }, inactive);
    expect(r.status).toBe("manual_review_required");
    expect(r.total).not.toBe(99);
  });

  it("requires a window count", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 0 } });
    expect(r.status).toBe("missing_information");
    expect(r.missing).toContain("windowCount");
  });

  it("preserves the screen-removal preparation instruction", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 6 } });
    expect(r.promotion?.prepInstructions.toLowerCase()).toContain("screen");
    const jobberDesc = r.jobberLineItems[0]?.description ?? "";
    expect(jobberDesc.toLowerCase()).toContain("screen");
  });

  it("stores promotion metadata in the result snapshot with the flat price", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 4 } });
    expect(r.promotion).toMatchObject({
      id: PROMO_ID,
      version: 1,
      flatPrice: 99,
      maxWindows: 10,
      windowCount: 4,
    });
  });

  it("jobber line item reconciles exactly with the total", () => {
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 7 } });
    const sum = r.jobberLineItems.reduce((s, li) => s + li.unitPrice, 0);
    expect(sum).toBe(r.total);
    expect(sum).toBe(99);
  });

  it("does not stack a discount code by default (stackingPolicy none)", () => {
    const r = calc({
      promotion: { id: PROMO_ID, windowCount: 5 },
      discount: { type: "percentage", value: 50, code: "HALF" },
    });
    expect(r.total).toBe(99);
    expect(r.discount).toBeNull();
  });

  it("rejects a promotion that has not started yet", () => {
    const future: PricingConfig = {
      ...LIVE_CONFIG,
      window_promo_99: { ...LIVE_CONFIG.window_promo_99!, effectiveStart: "2999-01-01" },
    };
    const r = calc({ promotion: { id: PROMO_ID, windowCount: 5 } }, future);
    expect(r.status).toBe("manual_review_required");
  });
});
