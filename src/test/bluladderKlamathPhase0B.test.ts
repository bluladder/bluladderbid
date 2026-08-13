import { describe, expect, it } from "vitest";
import {
  calculateWithOrganizationProfile,
  resolvePricingProfile,
  type OrganizationPricingProfile,
} from "../../packages/sales-engine/pricing/organizationPricing";
import type { OrganizationConnectorConfig } from "../../supabase/functions/_shared/connectorContracts";
import { selectOrganizationConnector } from "../../supabase/functions/_shared/organizationConnector";
import {
  resolveServiceAvailability,
  routeOrganizationByTerritory,
  type RoutingLocation,
  type TerritoryRule,
} from "../../supabase/functions/_shared/organizationRouting";
import { resolveOrganizationContext } from "../lib/organizations/context";
import {
  DFW_ORGANIZATION,
  DFW_ORGANIZATION_ID,
  INACTIVE_OREGON_ORGANIZATION,
  OREGON_ORGANIZATION_ID,
  dfwAdminMembership,
} from "../lib/organizations/fixtures";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function pricingProfile(
  overrides: Partial<OrganizationPricingProfile<Record<string, never>>> = {},
): OrganizationPricingProfile<Record<string, never>> {
  return {
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
    ...overrides,
  };
}

function connector(
  overrides: Partial<OrganizationConnectorConfig>,
): OrganizationConnectorConfig {
  return {
    id: "klamath-jobtread-planning",
    organizationId: OREGON_ORGANIZATION_ID,
    kind: "jobtread",
    status: "active",
    priority: 100,
    capabilities: ["health"],
    credentialReference: null,
    ...overrides,
  };
}

function inactiveCountyRule(id: string, county: string): TerritoryRule {
  return {
    id,
    name: `${county} County planning fixture`,
    organizationId: OREGON_ORGANIZATION_ID,
    organizationStatus: "provisioning",
    countryCode: "US",
    stateCode: "OR",
    county,
    effect: "include",
    priority: 100,
    status: "inactive",
  };
}

describe("BluLadder Klamath Phase 0B activation gate", () => {
  it("requires an independently approved Klamath copy instead of DFW fallback", () => {
    const klamathDraftCopy = pricingProfile({
      id: "klamath-pricing-draft",
      organizationId: OREGON_ORGANIZATION_ID,
      status: "draft",
    });

    expect(
      resolvePricingProfile(OREGON_ORGANIZATION_ID, [
        pricingProfile(),
        klamathDraftCopy,
      ]),
    ).toEqual({ status: "manual_review", reason: "profile_unapproved" });
  });

  it("keeps Klamath calculation in manual review until its own profile is approved", () => {
    let called = false;

    expect(
      calculateWithOrganizationProfile(
        OREGON_ORGANIZATION_ID,
        OREGON_ORGANIZATION_ID,
        {},
        [pricingProfile()],
        () => {
          called = true;
          return {};
        },
      ),
    ).toEqual({ status: "manual_review", reason: "profile_missing" });
    expect(called).toBe(false);
  });

  it("keeps inactive Klamath from becoming authoritative even with a matching membership", () => {
    const klamathMembership = {
      ...dfwAdminMembership(USER_ID),
      organizationId: OREGON_ORGANIZATION_ID,
    };

    expect(
      resolveOrganizationContext({
        authenticatedUserId: USER_ID,
        requestedOrganizationId: OREGON_ORGANIZATION_ID,
        organizations: [DFW_ORGANIZATION, INACTIVE_OREGON_ORGANIZATION],
        memberships: [klamathMembership],
      }),
    ).toEqual({ ok: false, reason: "inactive_organization" });
  });

  it("Klamath JobTread remains unsupported without validated capabilities", () => {
    expect(
      selectOrganizationConnector(OREGON_ORGANIZATION_ID, "booking_create", [
        connector({}),
        connector({
          id: "dfw-jobber",
          organizationId: DFW_ORGANIZATION_ID,
          kind: "jobber",
          capabilities: ["booking_create"],
          credentialReference: "credential://dfw-jobber",
        }),
      ]),
    ).toEqual({
      status: "manual_review",
      code: "capability_unsupported",
      candidateConnectorIds: ["klamath-jobtread-planning"],
    });
  });

  it("Klamath never falls back to DFW Jobber when JobTread lacks credentials", () => {
    expect(
      selectOrganizationConnector(OREGON_ORGANIZATION_ID, "booking_create", [
        connector({ capabilities: ["booking_create"] }),
        connector({
          id: "dfw-jobber",
          organizationId: DFW_ORGANIZATION_ID,
          kind: "jobber",
          capabilities: ["booking_create"],
          credentialReference: "credential://dfw-jobber",
        }),
      ]),
    ).toEqual({
      status: "manual_review",
      code: "credential_reference_missing",
      candidateConnectorIds: ["klamath-jobtread-planning"],
    });
  });

  it("Klamath and Lake planning rules remain inactive", () => {
    const rules = [
      inactiveCountyRule("klamath-county-planning", "Klamath"),
      inactiveCountyRule("lake-county-planning", "Lake"),
    ];
    const locations: RoutingLocation[] = [
      {
        countryCode: "US",
        stateCode: "OR",
        county: "Klamath",
        city: "Klamath Falls",
        postalCode: "97601",
      },
      {
        countryCode: "US",
        stateCode: "OR",
        county: "Lake",
        city: "Lakeview",
        postalCode: "97630",
      },
    ];

    for (const location of locations) {
      expect(routeOrganizationByTerritory(location, rules)).toEqual({
        status: "manual_review",
        reason: "unknown_territory",
        candidateOrganizationIds: [],
      });
    }
  });

  it("Klamath commercial and storefront services stay manual review", () => {
    const rules = [
      {
        organizationId: OREGON_ORGANIZATION_ID,
        serviceKey: "commercial_services",
        availability: "manual_review" as const,
        status: "active" as const,
        reason: "klamath_commercial_requires_manual_review",
      },
      {
        organizationId: OREGON_ORGANIZATION_ID,
        serviceKey: "storefront_window_cleaning",
        availability: "manual_review" as const,
        status: "active" as const,
        reason: "klamath_storefront_requires_manual_review",
      },
    ];

    expect(
      resolveServiceAvailability(
        OREGON_ORGANIZATION_ID,
        "commercial_services",
        rules,
      ),
    ).toEqual({
      status: "manual_review",
      reason: "klamath_commercial_requires_manual_review",
    });
    expect(
      resolveServiceAvailability(
        OREGON_ORGANIZATION_ID,
        "storefront_window_cleaning",
        rules,
      ),
    ).toEqual({
      status: "manual_review",
      reason: "klamath_storefront_requires_manual_review",
    });
  });
});
