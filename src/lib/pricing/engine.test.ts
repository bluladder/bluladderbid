import { describe, it, expect } from "vitest";
import { calculateQuote, PRICING_ENGINE_VERSION, type QuoteInput } from "./engine";
import { LIVE_CONFIG, baseHome, noServices } from "./__fixtures__/liveConfig";

function calc(input: Partial<QuoteInput> & { homeDetails: any; additionalServices: any }) {
  return calculateQuote(input as QuoteInput, LIVE_CONFIG, 1);
}

describe("pricing engine — active services calculate", () => {
  it("window exterior at 2500sqft uses per-sqft above minimum", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 2500 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.status).toBe("firm");
    expect(r.total).toBe(200); // 2500 * 0.08
  });

  it("house wash 2000sqft 1 story", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), houseWash: true },
    });
    expect(r.total).toBe(500); // 2000 * 0.25
  });

  it("roof cleaning 2000sqft asphalt light", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), roofCleaning: true, roofType: "asphalt", roofSeverity: "light" },
    });
    expect(r.total).toBe(600); // 2000 * 0.30
  });
});

describe("pricing engine — minimum charges enforced", () => {
  it("window minimum $185 for small home", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 1000 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.total).toBe(185); // 1000*0.08=80 -> min 185
    expect(r.lineItems[0].minimumApplied).toBe(true);
  });
  it("gutter minimum $200", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 1000 }),
      additionalServices: { ...noServices(), gutterCleaning: true },
    });
    expect(r.total).toBe(200); // 1000*0.08=80 -> min 200
  });
  it("house wash minimum $396", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 500 }),
      additionalServices: { ...noServices(), houseWash: true },
    });
    expect(r.total).toBe(396);
  });
  it("driveway minimum $200", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), drivewayCleaning: { enabled: true, sqft: 400, surfaceType: "concrete" } },
    });
    expect(r.total).toBe(200); // 400*0.20=80 -> min 200
  });
  it("pressure washing minimum $75", () => {
    const s = noServices();
    s.pressureWashing = { ...s.pressureWashing, enabled: true, frontPorch: { enabled: true, sqft: 200 } };
    const r = calc({ homeDetails: baseHome(), additionalServices: s });
    expect(r.total).toBe(75); // 200*0.25=50 -> min 75
  });
});

describe("pricing engine — story & condition modifiers", () => {
  it("2-story window adds 12%", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 3000, stories: 2 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    // 3000*0.08=240, +12% => 268.8 -> round 269
    expect(r.total).toBe(269);
  });
  it("heavy condition adds 15% to windows", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 3000, condition: "heavy" }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    // 3000*0.08=240 * 1.15 = 276
    expect(r.total).toBe(276);
  });
  it("interior + exterior adds interior per-sqft", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 3000, windowCleaningType: "both" }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    // ext 3000*0.08=240 ; int 3000*0.075=225 ; total 465
    expect(r.total).toBe(465);
  });
});

describe("pricing engine — add-ons & surcharges", () => {
  it("rust surcharge adds 15% to house wash", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), houseWash: true, houseWashDetails: { stainType: "rust" } },
    });
    // 500 + round(500*0.15=75) = 575
    expect(r.total).toBe(575);
  });
  it("gutter add-ons come from central config (drains/repairs/guards)", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: {
        ...noServices(),
        gutterCleaning: true,
        gutterAddons: {
          undergroundDrains: { enabled: true, count: "2" },
          minorRepairs: true,
          gutterGuards: { enabled: true, linearFeet: 150 },
        },
      },
    });
    // base min 200 + drains 125 + repairs 85 + guards 150*8=1200 = 1610
    expect(r.total).toBe(1610);
  });
});

describe("pricing engine — discounts", () => {
  it("percentage discount", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), houseWash: true },
      discount: { type: "percentage", value: 10, code: "SAVE10" },
    });
    expect(r.subtotal).toBe(500);
    expect(r.discount?.amount).toBe(50);
    expect(r.total).toBe(450);
  });
  it("fixed discount never exceeds subtotal", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 1000 }),
      additionalServices: { ...noServices(), windowCleaning: true },
      discount: { type: "fixed", value: 1000, code: "BIG" },
    });
    expect(r.total).toBe(0);
    expect(r.discount?.amount).toBe(185);
  });
});

describe("pricing engine — safe failure modes", () => {
  it("no services -> missing_information", () => {
    const r = calc({ homeDetails: baseHome(), additionalServices: noServices() });
    expect(r.status).toBe("missing_information");
    expect(r.missing).toContain("services");
    expect(r.firm).toBe(false);
  });
  it("missing square footage -> missing_information", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: undefined }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.status).toBe("missing_information");
    expect(r.missing).toContain("squareFootage");
  });
  it("invalid stories -> missing_information", () => {
    const r = calc({
      homeDetails: baseHome({ stories: 7 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.status).toBe("missing_information");
    expect(r.missing).toContain("stories");
  });
  it("negative square footage -> missing_information", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: -500 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.status).toBe("missing_information");
  });
  it("extreme square footage -> manual_review_required", () => {
    const r = calc({
      homeDetails: baseHome({ squareFootage: 500000 }),
      additionalServices: { ...noServices(), windowCleaning: true },
    });
    expect(r.status).toBe("manual_review_required");
    expect(r.firm).toBe(false);
  });
  it("missing pricing config -> manual_review_required, no guessed price", () => {
    const partial = { ...LIVE_CONFIG, house_wash: undefined as any };
    const r = calculateQuote(
      { homeDetails: baseHome(), additionalServices: { ...noServices(), houseWash: true } } as QuoteInput,
      partial,
      1,
    );
    expect(r.status).toBe("manual_review_required");
    expect(r.total).toBe(0);
  });
});

describe("pricing engine — integrity guarantees", () => {
  it("engine never accepts a client-submitted total (not in input type)", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), houseWash: true, total: 1 },
    });
    expect(r.total).toBe(500);
  });
  it("deterministic: same input -> same result", () => {
    const input = {
      homeDetails: baseHome({ squareFootage: 2750, stories: 2 }),
      additionalServices: { ...noServices(), windowCleaning: true, houseWash: true, gutterCleaning: true },
    };
    const a = calc(input);
    const b = calc(input);
    expect(a).toEqual(b);
  });
  it("stamps engine + rule version", () => {
    const r = calc({ homeDetails: baseHome(), additionalServices: { ...noServices(), houseWash: true } });
    expect(r.engineVersion).toBe(PRICING_ENGINE_VERSION);
    expect(r.ruleVersion).toBe(1);
  });
  it("jobber line items reconcile with subtotal", () => {
    const r = calc({
      homeDetails: baseHome(),
      additionalServices: { ...noServices(), houseWash: true, gutterCleaning: true },
    });
    const jobberSum = r.jobberLineItems.reduce((s, li) => s + li.unitPrice, 0);
    expect(jobberSum).toBe(r.subtotal);
  });
});