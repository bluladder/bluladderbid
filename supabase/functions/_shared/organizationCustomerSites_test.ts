import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDfwCustomerSiteRoute,
  type OrganizationCustomerSiteRoute,
  resolveOrganizationCustomerSite,
} from "./organizationCustomerSites.ts";
import {
  DFW_ORGANIZATION_ID,
  OREGON_TEST_ORGANIZATION_ID,
} from "./organizationRouting.ts";

function activeKlamathRoute(
  overrides: Partial<OrganizationCustomerSiteRoute> = {},
): OrganizationCustomerSiteRoute {
  return {
    tenantKey: "bluladder-klamath",
    organizationId: OREGON_TEST_ORGANIZATION_ID,
    organizationStatus: "active",
    canonicalHostname: "klamath.bluladder.com",
    baseUrl: "https://klamath.bluladder.com",
    mappingStatus: "active",
    runtimeRoutingEnabled: true,
    sitePublished: true,
    customerTrafficAllowed: true,
    ...overrides,
  };
}

Deno.test("customer sites: DFW exact organization keeps its canonical customer URL", () => {
  assertEquals(
    resolveOrganizationCustomerSite(DFW_ORGANIZATION_ID, [
      buildDfwCustomerSiteRoute("https://bid.bluladder.com/"),
    ]),
    {
      status: "resolved",
      tenantKey: "bluladder-dfw",
      organizationId: DFW_ORGANIZATION_ID,
      canonicalHostname: "bid.bluladder.com",
      baseUrl: "https://bid.bluladder.com",
    },
  );
});

Deno.test("customer sites: unknown organization never falls back to DFW", () => {
  assertEquals(
    resolveOrganizationCustomerSite(OREGON_TEST_ORGANIZATION_ID, [
      buildDfwCustomerSiteRoute("https://bid.bluladder.com"),
    ]),
    { status: "blocked", code: "customer_site_unavailable" },
  );
});

Deno.test("customer sites: Klamath activation gates fail independently", () => {
  for (const [override, code] of [
    [{ organizationStatus: "provisioning" }, "organization_inactive"],
    [{ mappingStatus: "unprovisioned" }, "site_mapping_inactive"],
    [{ runtimeRoutingEnabled: false }, "runtime_routing_disabled"],
    [{ sitePublished: false }, "site_unpublished"],
    [{ customerTrafficAllowed: false }, "customer_traffic_disabled"],
  ] as const) {
    assertEquals(
      resolveOrganizationCustomerSite(OREGON_TEST_ORGANIZATION_ID, [
        activeKlamathRoute(override),
      ]),
      { status: "blocked", code },
    );
  }
});

Deno.test("customer sites: invalid, ambiguous, or unsafe routes fail closed", () => {
  assertEquals(resolveOrganizationCustomerSite("browser-supplied", []), {
    status: "blocked",
    code: "invalid_organization_authority",
  });
  const route = activeKlamathRoute();
  assertEquals(
    resolveOrganizationCustomerSite(OREGON_TEST_ORGANIZATION_ID, [
      route,
      { ...route },
    ]),
    { status: "blocked", code: "ambiguous_customer_site" },
  );
  for (const baseUrl of [
    "http://klamath.bluladder.com",
    "https://klamath.bluladder.com/path",
    "https://klamath.bluladder.com?organization=dfw",
    "https://user:secret@klamath.bluladder.com",
    "https://other.bluladder.com",
    "https://preview.lovable.app",
  ]) {
    assertEquals(
      resolveOrganizationCustomerSite(OREGON_TEST_ORGANIZATION_ID, [
        activeKlamathRoute({ baseUrl }),
      ]),
      { status: "blocked", code: "invalid_customer_site_url" },
    );
  }
});
