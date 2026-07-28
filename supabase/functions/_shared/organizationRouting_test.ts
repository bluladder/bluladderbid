import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildLeadRoutingTags,
  DFW_ORGANIZATION_ID,
  OREGON_TEST_ORGANIZATION_ID,
  resolveOrganizationContact,
  resolveServiceAvailability,
  routeOrganizationByTerritory,
  type RoutingLocation,
  type TerritoryRule,
} from "./organizationRouting.ts";

const dfw: RoutingLocation = {
  countryCode: "US",
  stateCode: "TX",
  county: "Dallas",
  city: "Dallas",
  postalCode: "75201",
};
const oregon: RoutingLocation = {
  countryCode: "US",
  stateCode: "OR",
  county: "Multnomah",
  city: "Portland",
  postalCode: "97205",
};

function rule(
  overrides:
    & Partial<TerritoryRule>
    & Pick<TerritoryRule, "id" | "organizationId">,
): TerritoryRule {
  return {
    name: "Test territory",
    organizationStatus: "active",
    countryCode: "US",
    effect: "include",
    priority: 100,
    status: "active",
    ...overrides,
  };
}

Deno.test("DFW compatibility fixture routes deterministically by ZIP", () => {
  const result = routeOrganizationByTerritory(dfw, [
    rule({
      id: "dfw-state",
      organizationId: DFW_ORGANIZATION_ID,
      stateCode: "TX",
      priority: 10,
    }),
    rule({
      id: "dfw-zip",
      organizationId: DFW_ORGANIZATION_ID,
      name: "DFW core",
      postalCode: "75201",
      priority: 100,
    }),
  ]);
  assertEquals(result, {
    status: "routed",
    organizationId: DFW_ORGANIZATION_ID,
    matchedRuleId: "dfw-zip",
    region: "DFW core",
    matchedBy: "postal_code",
  });
});

Deno.test("higher priority rule wins before geographic specificity", () => {
  const result = routeOrganizationByTerritory(dfw, [
    rule({
      id: "dfw-zip-low",
      organizationId: DFW_ORGANIZATION_ID,
      postalCode: "75201",
      priority: 10,
    }),
    rule({
      id: "dfw-city-high",
      organizationId: DFW_ORGANIZATION_ID,
      city: "Dallas",
      priority: 20,
    }),
  ]);
  assertEquals(
    result.status === "routed" && result.matchedRuleId,
    "dfw-city-high",
  );
});

Deno.test("equal-rank organizations are ambiguous", () => {
  const result = routeOrganizationByTerritory(dfw, [
    rule({
      id: "a",
      organizationId: DFW_ORGANIZATION_ID,
      city: "Dallas",
    }),
    rule({
      id: "b",
      organizationId: OREGON_TEST_ORGANIZATION_ID,
      city: "Dallas",
    }),
  ]);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.reason, "overlapping_territory");
  }
});

Deno.test("equal-rank include and exclusion conflict fails closed", () => {
  const result = routeOrganizationByTerritory(dfw, [
    rule({
      id: "include",
      organizationId: DFW_ORGANIZATION_ID,
      postalCode: "75201",
    }),
    rule({
      id: "exclude",
      organizationId: DFW_ORGANIZATION_ID,
      postalCode: "75201",
      effect: "exclude",
    }),
  ]);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.reason, "conflicting_rules");
  }
});

Deno.test("higher-priority exclusion prevents routing", () => {
  const result = routeOrganizationByTerritory(dfw, [
    rule({
      id: "include",
      organizationId: DFW_ORGANIZATION_ID,
      stateCode: "TX",
      priority: 10,
    }),
    rule({
      id: "exclude",
      organizationId: DFW_ORGANIZATION_ID,
      postalCode: "75201",
      effect: "exclude",
      priority: 20,
    }),
  ]);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.reason, "unknown_territory");
  }
});

Deno.test("inactive Oregon fixture never routes", () => {
  const result = routeOrganizationByTerritory(oregon, [
    rule({
      id: "or",
      organizationId: OREGON_TEST_ORGANIZATION_ID,
      organizationStatus: "provisioning",
      stateCode: "OR",
    }),
  ]);
  assertEquals(result.status, "manual_review");
  if (result.status === "manual_review") {
    assertEquals(result.reason, "organization_inactive");
  }
});

Deno.test("unknown and incomplete locations never fall back to DFW", () => {
  assertEquals(routeOrganizationByTerritory(oregon, []), {
    status: "manual_review",
    reason: "unknown_territory",
    candidateOrganizationIds: [],
  });
  assertEquals(
    routeOrganizationByTerritory({ ...oregon, stateCode: "" }, []),
    {
      status: "manual_review",
      reason: "location_incomplete",
      candidateOrganizationIds: [],
    },
  );
});

Deno.test("service availability is organization-specific and fails closed", () => {
  const rules = [{
    organizationId: DFW_ORGANIZATION_ID,
    serviceKey: "window_cleaning",
    availability: "available" as const,
    status: "active" as const,
  }];
  assertEquals(
    resolveServiceAvailability(
      DFW_ORGANIZATION_ID,
      "window_cleaning",
      rules,
    ).status,
    "available",
  );
  assertEquals(
    resolveServiceAvailability(
      OREGON_TEST_ORGANIZATION_ID,
      "window_cleaning",
      rules,
    ),
    {
      status: "manual_review",
      reason: "organization_service_not_configured",
    },
  );
});

Deno.test("lead tags preserve route and normalized geography contract", () => {
  const route = routeOrganizationByTerritory(dfw, [
    rule({
      id: "dfw",
      name: "Dallas region",
      organizationId: DFW_ORGANIZATION_ID,
      city: "Dallas",
    }),
  ]);
  assertEquals(buildLeadRoutingTags(dfw, route, "website_quote"), {
    organizationId: DFW_ORGANIZATION_ID,
    region: "Dallas region",
    city: "Dallas",
    county: "Dallas",
    state: "TX",
    postalCode: "75201",
    entrySource: "website_quote",
    routingStatus: "routed",
  });
});

Deno.test("escalation contacts are organization-isolated and ambiguity fails closed", () => {
  const contacts = [
    {
      id: "dfw-primary",
      organizationId: DFW_ORGANIZATION_ID,
      contactType: "escalation_sms" as const,
      destination: "dfw-destination",
      priority: 10,
      status: "active" as const,
    },
    {
      id: "or-primary",
      organizationId: OREGON_TEST_ORGANIZATION_ID,
      contactType: "escalation_sms" as const,
      destination: "oregon-destination",
      priority: 10,
      status: "inactive" as const,
    },
  ];
  const result = resolveOrganizationContact(
    DFW_ORGANIZATION_ID,
    "escalation_sms",
    contacts,
  );
  assertEquals(
    result.status === "resolved" && result.contact.destination,
    "dfw-destination",
  );
  assertEquals(
    resolveOrganizationContact(
      OREGON_TEST_ORGANIZATION_ID,
      "escalation_sms",
      contacts,
    ),
    { status: "manual_review", reason: "missing_contact" },
  );

  assertEquals(
    resolveOrganizationContact(
      DFW_ORGANIZATION_ID,
      "escalation_email",
      [
        {
          ...contacts[0],
          id: "email-a",
          contactType: "escalation_email",
          destination: "a@example.invalid",
        },
        {
          ...contacts[0],
          id: "email-b",
          contactType: "escalation_email",
          destination: "b@example.invalid",
        },
      ],
    ),
    { status: "manual_review", reason: "ambiguous_contact" },
  );
});
