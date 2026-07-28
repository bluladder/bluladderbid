import { describe, expect, it } from "vitest";
import {
  calculateWithOrganizationProfile,
  type OrganizationPricingProfile,
  type OrganizationServiceCatalogEntry,
  resolveCatalogStrategy,
  resolvePricingProfile,
} from "./organizationPricing";
import {
  calculateQuote,
  type PricingConfig,
  type QuoteInput,
} from "../../../src/lib/pricing/engine";
import {
  baseHome,
  LIVE_CONFIG,
  noServices,
} from "../../../src/lib/pricing/__fixtures__/liveConfig";

const DFW = "b1addf00-0000-4000-8000-000000000001";
const OREGON = "b1addf00-0000-4000-8000-000000000002";

function service(
  overrides: Partial<OrganizationServiceCatalogEntry> = {},
): OrganizationServiceCatalogEntry {
  return {
    id: "dfw-window",
    organizationId: DFW,
    serviceKey: "window_cleaning",
    name: "Window cleaning",
    kind: "standard",
    approvalStatus: "approved",
    quoteAvailability: "enabled",
    planAvailability: "enabled",
    pricingStrategies: ["square_footage"],
    pricingPriority: ["square_footage"],
    laborStrategy: "configured_formula",
    durationStrategy: "configured_formula",
    ...overrides,
  };
}

function profile(
  overrides: Partial<OrganizationPricingProfile<PricingConfig>> = {},
): OrganizationPricingProfile<PricingConfig> {
  return {
    id: "dfw-pricing-v1",
    organizationId: DFW,
    version: 1,
    status: "approved",
    effectiveFrom: null,
    config: LIVE_CONFIG,
    minimums: {},
    laborTargets: {},
    travelRules: {},
    discounts: {},
    taxRules: {},
    buffers: {},
    manualReviewThresholds: {},
    ...overrides,
  };
}

describe("organization service catalog strategy resolution", () => {
  it("never uses another organization's service", () => {
    expect(
      resolveCatalogStrategy(
        OREGON,
        "window_cleaning",
        "quote",
        null,
        ["square_footage"],
        [service()],
      ),
    ).toEqual({ status: "manual_review", reason: "service_missing" });
  });

  it("requires owner-approved service configuration", () => {
    expect(
      resolveCatalogStrategy(
        DFW,
        "window_cleaning",
        "quote",
        null,
        ["square_footage"],
        [service({ approvalStatus: "draft" })],
      ),
    ).toEqual({ status: "manual_review", reason: "service_unapproved" });
  });

  it("treats duplicate organization service entries as ambiguous", () => {
    expect(
      resolveCatalogStrategy(
        DFW,
        "window_cleaning",
        "quote",
        null,
        ["square_footage"],
        [service(), service({ id: "duplicate-dfw-window" })],
      ),
    ).toEqual({ status: "manual_review", reason: "service_ambiguous" });
  });

  it("enforces quote and plan availability independently", () => {
    expect(
      resolveCatalogStrategy(
        DFW,
        "window_cleaning",
        "plan",
        null,
        ["square_footage"],
        [service({ planAvailability: "disabled" })],
      ),
    ).toEqual({ status: "manual_review", reason: "service_disabled" });
  });

  it("supports explicitly prioritized window pricing methods", () => {
    const entry = service({
      pricingStrategies: ["window_count", "pane_count", "manual_quote"],
      pricingPriority: ["pane_count", "window_count", "manual_quote"],
    });
    const result = resolveCatalogStrategy(
      DFW,
      "window_cleaning",
      "quote",
      null,
      ["window_count", "pane_count"],
      [entry],
    );
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.strategy).toBe("pane_count");
  });

  it("unsupported inputs enter manual review", () => {
    expect(
      resolveCatalogStrategy(
        DFW,
        "window_cleaning",
        "quote",
        "pane_count",
        ["square_footage"],
        [service({ pricingStrategies: ["pane_count"] })],
      ),
    ).toEqual({ status: "manual_review", reason: "inputs_unsupported" });
  });
});

describe("organization pricing profile", () => {
  it("selects the highest unique approved version", () => {
    expect(
      resolvePricingProfile(DFW, [profile(), profile({
        id: "dfw-pricing-v2",
        version: 2,
      })]),
    ).toMatchObject({
      status: "resolved",
      profile: { id: "dfw-pricing-v2", version: 2 },
    });
  });

  it("duplicate approved versions fail closed", () => {
    expect(
      resolvePricingProfile(DFW, [
        profile(),
        profile({ id: "duplicate-v1" }),
      ]),
    ).toEqual({ status: "manual_review", reason: "profile_ambiguous" });
  });

  it("inactive Oregon has no implicit DFW profile", () => {
    expect(resolvePricingProfile(OREGON, [profile()])).toEqual({
      status: "manual_review",
      reason: "profile_missing",
    });
  });

  it("blocks cross-organization calculation before engine invocation", () => {
    let called = false;
    const result = calculateWithOrganizationProfile(
      DFW,
      OREGON,
      {},
      [profile()],
      () => {
        called = true;
        return {};
      },
    );
    expect(called).toBe(false);
    expect(result).toEqual({
      status: "manual_review",
      reason: "organization_lineage_mismatch",
    });
  });

  it("reproduces the current DFW canonical quote exactly", () => {
    const input: QuoteInput = {
      homeDetails: baseHome({
        squareFootage: 2500,
        stories: 2,
        windowCleaningType: "both",
      }),
      additionalServices: {
        ...noServices(),
        windowCleaning: true,
        gutterCleaning: true,
      },
    };
    const legacy = calculateQuote(input, LIVE_CONFIG);
    const wrapped = calculateWithOrganizationProfile(
      DFW,
      DFW,
      input,
      [profile()],
      calculateQuote,
    );
    expect(wrapped.status).toBe("ok");
    if (wrapped.status === "ok") expect(wrapped.value).toEqual(legacy);
  });
});
