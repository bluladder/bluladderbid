import { describe, expect, it } from "vitest";
import {
  buildLeadRoutingTags,
  DFW_ORGANIZATION_ID,
  OREGON_TEST_ORGANIZATION_ID,
  routeOrganizationByTerritory,
  type TerritoryRule,
} from "../../../supabase/functions/_shared/organizationRouting";
import {
  legacyDfwSignal,
  resolveOrganizationContext,
} from "../../../supabase/functions/_shared/organizationResolver";
import { selectOrganizationConnector } from "../../../supabase/functions/_shared/organizationConnector";
import type { OrganizationConnectorConfig } from "../../../supabase/functions/_shared/connectorContracts";
import {
  resolveCatalogStrategy,
  resolvePricingProfile,
  type OrganizationPricingProfile,
  type OrganizationServiceCatalogEntry,
} from "../pricing/organizationPricing";
import {
  rankRecommendations,
  type CustomerFeatureSnapshot,
  type RecommendationModel,
} from "../../../src/lib/customerIntelligence/recommendationEngine";

const dfwTerritory: TerritoryRule = {
  id: "dfw-texas",
  name: "DFW",
  organizationId: DFW_ORGANIZATION_ID,
  organizationStatus: "active",
  countryCode: "US",
  stateCode: "TX",
  effect: "include",
  priority: 10,
  status: "active",
};
const oregonTerritory: TerritoryRule = {
  ...dfwTerritory,
  id: "oregon-test",
  name: "Oregon test",
  organizationId: OREGON_TEST_ORGANIZATION_ID,
  organizationStatus: "provisioning",
  stateCode: "OR",
};
const connector: OrganizationConnectorConfig = {
  id: "dfw-jobber",
  organizationId: DFW_ORGANIZATION_ID,
  kind: "jobber",
  status: "active",
  priority: 10,
  capabilities: ["quote_sync"],
  credentialReference: "credential://dfw-jobber",
};
const service: OrganizationServiceCatalogEntry = {
  id: "dfw-window",
  organizationId: DFW_ORGANIZATION_ID,
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
};
const profile: OrganizationPricingProfile = {
  id: "dfw-pricing-v1",
  organizationId: DFW_ORGANIZATION_ID,
  version: 1,
  status: "approved",
  effectiveFrom: null,
  config: {},
  minimums: {},
  laborTargets: {},
  travelRules: {},
  discounts: {},
  taxRules: {},
  buffers: {},
  manualReviewThresholds: {},
};
const features: CustomerFeatureSnapshot = {
  organizationId: DFW_ORGANIZATION_ID,
  featureVersion: "v1",
  inputFingerprint: "fixture",
  asOf: "2026-07-28T00:00:00.000Z",
  lifetimeValue: 500,
  completedJobCount: 2,
  cancellationCount: 0,
  daysSinceLastCompleted: 200,
  serviceCounts: { window_cleaning: 2 },
  serviceLastCompletedAt: { window_cleaning: "2026-01-01T00:00:00.000Z" },
  inferredServiceCadenceDays: { window_cleaning: 180 },
  recentComplaint: false,
  recentCancellation: false,
  season: "summer",
  archivedStatus: "active",
};
const model: RecommendationModel = {
  id: "dfw-model-v1",
  organizationId: DFW_ORGANIZATION_ID,
  modelKey: "service-next-best-action",
  version: 1,
  status: "approved",
  weights: { recency_due: 1 },
  bounds: {
    minWeight: -4,
    maxWeight: 4,
    maxDeltaPerRun: 0.1,
    minimumOutcomes: 5,
    minimumPositiveOutcomes: 2,
  },
  priors: {
    baseProbability: 0.15,
    serviceDefaultCadenceDays: { window_cleaning: 180 },
  },
};

describe("cross-contract tenant isolation", () => {
  it("preserves the explicit DFW path across every pure contract", () => {
    const route = routeOrganizationByTerritory({
      countryCode: "US",
      stateCode: "TX",
      county: "Collin",
      city: "McKinney",
      postalCode: "75070",
    }, [dfwTerritory, oregonTerritory]);
    expect(route).toMatchObject({
      status: "routed",
      organizationId: DFW_ORGANIZATION_ID,
    });
    if (route.status !== "routed") throw new Error("expected DFW route");

    expect(selectOrganizationConnector(
      route.organizationId,
      "quote_sync",
      [connector],
    ).status).toBe("resolved");
    expect(resolveCatalogStrategy(
      route.organizationId,
      "window_cleaning",
      "quote",
      null,
      ["square_footage"],
      [service],
    ).status).toBe("resolved");
    expect(resolvePricingProfile(route.organizationId, [profile]).status)
      .toBe("resolved");
    expect(rankRecommendations({
      services: ["window_cleaning"],
      features,
      model,
      catalog: [service],
    })).toHaveLength(1);
  });

  it("keeps inactive Oregon from inheriting any DFW dependency", () => {
    const route = routeOrganizationByTerritory({
      countryCode: "US",
      stateCode: "OR",
      county: "Multnomah",
      city: "Portland",
      postalCode: "97201",
    }, [dfwTerritory, oregonTerritory]);
    expect(route).toMatchObject({
      status: "manual_review",
      reason: "organization_inactive",
    });
    expect(selectOrganizationConnector(
      OREGON_TEST_ORGANIZATION_ID,
      "quote_sync",
      [connector],
    )).toMatchObject({ status: "manual_review", code: "connector_missing" });
    expect(resolveCatalogStrategy(
      OREGON_TEST_ORGANIZATION_ID,
      "window_cleaning",
      "quote",
      null,
      ["square_footage"],
      [service],
    )).toMatchObject({ status: "manual_review", reason: "service_missing" });
    expect(resolvePricingProfile(OREGON_TEST_ORGANIZATION_ID, [profile]))
      .toMatchObject({ status: "manual_review", reason: "profile_missing" });
    expect(() => rankRecommendations({
      services: ["window_cleaning"],
      features: { ...features, organizationId: OREGON_TEST_ORGANIZATION_ID },
      model,
      catalog: [service],
    })).toThrow("organization_lineage_mismatch");
  });

  it("keeps ambiguous routing unowned and rejects conflicting signals", () => {
    const overlapping = {
      ...dfwTerritory,
      id: "oregon-overlap",
      organizationId: OREGON_TEST_ORGANIZATION_ID,
      organizationStatus: "active" as const,
    };
    const location = {
      countryCode: "US",
      stateCode: "TX",
      county: "Collin",
      city: "McKinney",
      postalCode: "75070",
    };
    const route = routeOrganizationByTerritory(location, [
      dfwTerritory,
      overlapping,
    ]);
    expect(route).toMatchObject({
      status: "manual_review",
      reason: "overlapping_territory",
    });
    expect(buildLeadRoutingTags(location, route, "web").organizationId)
      .toBeNull();
    expect(resolveOrganizationContext([
      {
        organizationId: DFW_ORGANIZATION_ID,
        source: "resource",
        evidence: "quote",
      },
      {
        organizationId: OREGON_TEST_ORGANIZATION_ID,
        source: "territory",
        evidence: "address",
      },
    ])).toEqual({ ok: false, reason: "conflict" });
  });

  it("allows legacy DFW identity only through the explicit compatibility gate", () => {
    const signal = legacyDfwSignal("legacy DFW entry point");
    expect(resolveOrganizationContext([signal])).toEqual({
      ok: false,
      reason: "legacy_not_allowed",
    });
    expect(resolveOrganizationContext([signal], { allowLegacyDfw: true }))
      .toMatchObject({
        ok: true,
        organizationId: DFW_ORGANIZATION_ID,
        source: "legacy_dfw",
      });
  });
});
