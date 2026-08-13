import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { OrganizationConnectorConfig } from "./connectorContracts.ts";
import { selectOrganizationConnector } from "./organizationConnector.ts";
import {
  OREGON_TEST_ORGANIZATION_ID,
  type OrganizationServiceRule,
  resolveServiceAvailability,
  routeOrganizationByTerritory,
  type RoutingLocation,
  type TerritoryRule,
} from "./organizationRouting.ts";

const DFW_ORGANIZATION_ID = "b1addf00-0000-4000-8000-000000000001";
const KLAMATH_ORGANIZATION_ID = OREGON_TEST_ORGANIZATION_ID;

function connector(
  overrides: Partial<OrganizationConnectorConfig>,
): OrganizationConnectorConfig {
  return {
    id: "klamath-jobtread-planning",
    organizationId: KLAMATH_ORGANIZATION_ID,
    kind: "jobtread",
    status: "active",
    priority: 100,
    capabilities: ["health"],
    credentialReference: null,
    ...overrides,
  };
}

Deno.test("Klamath JobTread remains unsupported without validated capabilities", () => {
  assertEquals(
    selectOrganizationConnector(KLAMATH_ORGANIZATION_ID, "booking_create", [
      connector({}),
      connector({
        id: "dfw-jobber",
        organizationId: DFW_ORGANIZATION_ID,
        kind: "jobber",
        capabilities: ["booking_create"],
        credentialReference: "vault://dfw/jobber",
      }),
    ]),
    {
      status: "manual_review",
      code: "capability_unsupported",
      candidateConnectorIds: ["klamath-jobtread-planning"],
    },
  );
});

Deno.test("Klamath never falls back to DFW Jobber when JobTread lacks credentials", () => {
  assertEquals(
    selectOrganizationConnector(KLAMATH_ORGANIZATION_ID, "booking_create", [
      connector({ capabilities: ["booking_create"] }),
      connector({
        id: "dfw-jobber",
        organizationId: DFW_ORGANIZATION_ID,
        kind: "jobber",
        capabilities: ["booking_create"],
        credentialReference: "vault://dfw/jobber",
      }),
    ]),
    {
      status: "manual_review",
      code: "credential_reference_missing",
      candidateConnectorIds: ["klamath-jobtread-planning"],
    },
  );
});

function inactiveCountyRule(id: string, county: string): TerritoryRule {
  return {
    id,
    name: `${county} County planning fixture`,
    organizationId: KLAMATH_ORGANIZATION_ID,
    organizationStatus: "provisioning",
    countryCode: "US",
    stateCode: "OR",
    county,
    effect: "include",
    priority: 100,
    status: "inactive",
  };
}

Deno.test("Klamath and Lake planning rules remain inactive", () => {
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
    assertEquals(routeOrganizationByTerritory(location, rules), {
      status: "manual_review",
      reason: "unknown_territory",
      candidateOrganizationIds: [],
    });
  }
});

Deno.test("Klamath commercial and storefront services stay manual review", () => {
  const rules: OrganizationServiceRule[] = [
    {
      organizationId: KLAMATH_ORGANIZATION_ID,
      serviceKey: "commercial_services",
      availability: "manual_review",
      status: "active",
      reason: "klamath_commercial_requires_manual_review",
    },
    {
      organizationId: KLAMATH_ORGANIZATION_ID,
      serviceKey: "storefront_window_cleaning",
      availability: "manual_review",
      status: "active",
      reason: "klamath_storefront_requires_manual_review",
    },
  ];

  assertEquals(
    resolveServiceAvailability(
      KLAMATH_ORGANIZATION_ID,
      "commercial_services",
      rules,
    ),
    {
      status: "manual_review",
      reason: "klamath_commercial_requires_manual_review",
    },
  );
  assertEquals(
    resolveServiceAvailability(
      KLAMATH_ORGANIZATION_ID,
      "storefront_window_cleaning",
      rules,
    ),
    {
      status: "manual_review",
      reason: "klamath_storefront_requires_manual_review",
    },
  );
});
