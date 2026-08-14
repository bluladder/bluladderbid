import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildDfwCustomerSiteRoute,
  loadOrganizationCustomerSiteRoutes,
  type OrganizationCustomerSiteRoute,
  resolveOrganizationCustomerSite,
} from "./organizationCustomerSites.ts";
import {
  DFW_ORGANIZATION_ID,
  OREGON_TEST_ORGANIZATION_ID,
} from "./organizationRouting.ts";

const KLAMATH_ORGANIZATION_ID = "b1addf00-0000-4000-8000-000000000003";

function hostedSiteClient(options: {
  organizationRows?: Array<Record<string, unknown>>;
  siteRows?: Array<Record<string, unknown>>;
  organizationError?: boolean;
  siteError?: boolean;
} = {}) {
  const touched: string[] = [];
  return {
    touched,
    from(table: string) {
      touched.push(table);
      const chain = {
        select: (_columns: string) => chain,
        eq: (_column: string, _value: unknown) => chain,
        limit: (_count: number) =>
          Promise.resolve({
            data: table === "organizations"
              ? options.organizationRows ?? [{
                id: KLAMATH_ORGANIZATION_ID,
                status: "provisioning",
              }]
              : options.siteRows ?? [{
                tenant_key: "bluladder-klamath",
                organization_id: KLAMATH_ORGANIZATION_ID,
                canonical_hostname: "klamath.bluladder.com",
                mapping_status: "provisioning",
                runtime_routing_enabled: false,
                site_published: false,
                customer_traffic_allowed: false,
              }],
            error: table === "organizations"
              ? options.organizationError ? { message: "unreadable" } : null
              : options.siteError
              ? { message: "unreadable" }
              : null,
          }),
      };
      return chain;
    },
  };
}

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
  for (
    const [override, code] of [
      [{ organizationStatus: "provisioning" }, "organization_inactive"],
      [{ mappingStatus: "unprovisioned" }, "site_mapping_inactive"],
      [{ runtimeRoutingEnabled: false }, "runtime_routing_disabled"],
      [{ sitePublished: false }, "site_unpublished"],
      [{ customerTrafficAllowed: false }, "customer_traffic_disabled"],
    ] as const
  ) {
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
  for (
    const baseUrl of [
      "http://klamath.bluladder.com",
      "https://klamath.bluladder.com/path",
      "https://klamath.bluladder.com?organization=dfw",
      "https://user:secret@klamath.bluladder.com",
      "https://other.bluladder.com",
      "https://preview.lovable.app",
    ]
  ) {
    assertEquals(
      resolveOrganizationCustomerSite(OREGON_TEST_ORGANIZATION_ID, [
        activeKlamathRoute({ baseUrl }),
      ]),
      { status: "blocked", code: "invalid_customer_site_url" },
    );
  }
});

Deno.test("customer sites: loader preserves exact DFW compatibility without a database read", async () => {
  const supabase = hostedSiteClient({
    organizationError: true,
    siteError: true,
  });
  const routes = await loadOrganizationCustomerSiteRoutes(
    supabase,
    DFW_ORGANIZATION_ID,
    { dfwBaseUrl: "https://bid.bluladder.com" },
  );
  assertEquals(supabase.touched, []);
  assertEquals(
    resolveOrganizationCustomerSite(DFW_ORGANIZATION_ID, routes).status,
    "resolved",
  );
});

Deno.test("customer sites: current hosted Klamath foundation loads but remains inactive", async () => {
  const routes = await loadOrganizationCustomerSiteRoutes(
    hostedSiteClient(),
    KLAMATH_ORGANIZATION_ID,
  );
  assertEquals(routes.length, 1);
  assertEquals(
    resolveOrganizationCustomerSite(KLAMATH_ORGANIZATION_ID, routes),
    { status: "blocked", code: "organization_inactive" },
  );
});

Deno.test("customer sites: one fully active hosted route resolves for its organization", async () => {
  const routes = await loadOrganizationCustomerSiteRoutes(
    hostedSiteClient({
      organizationRows: [{
        id: KLAMATH_ORGANIZATION_ID,
        status: "active",
      }],
      siteRows: [{
        tenant_key: "bluladder-klamath",
        organization_id: KLAMATH_ORGANIZATION_ID,
        canonical_hostname: "klamath.bluladder.com",
        mapping_status: "active",
        runtime_routing_enabled: true,
        site_published: true,
        customer_traffic_allowed: true,
      }],
    }),
    KLAMATH_ORGANIZATION_ID,
  );
  assertEquals(
    resolveOrganizationCustomerSite(KLAMATH_ORGANIZATION_ID, routes),
    {
      status: "resolved",
      tenantKey: "bluladder-klamath",
      organizationId: KLAMATH_ORGANIZATION_ID,
      canonicalHostname: "klamath.bluladder.com",
      baseUrl: "https://klamath.bluladder.com",
    },
  );
});

Deno.test("customer sites: unreadable, malformed, and duplicate hosted evidence fails closed", async () => {
  for (
    const client of [
      hostedSiteClient({ siteError: true }),
      hostedSiteClient({ organizationRows: [] }),
      hostedSiteClient({
        siteRows: [{
          tenant_key: "bluladder-klamath",
          organization_id: DFW_ORGANIZATION_ID,
          canonical_hostname: "bid.bluladder.com",
          mapping_status: "active",
          runtime_routing_enabled: true,
          site_published: true,
          customer_traffic_allowed: true,
        }],
      }),
    ]
  ) {
    assertEquals(
      await loadOrganizationCustomerSiteRoutes(
        client,
        KLAMATH_ORGANIZATION_ID,
      ),
      [],
    );
  }

  const duplicate = {
    tenant_key: "bluladder-klamath",
    organization_id: KLAMATH_ORGANIZATION_ID,
    canonical_hostname: "klamath.bluladder.com",
    mapping_status: "active",
    runtime_routing_enabled: true,
    site_published: true,
    customer_traffic_allowed: true,
  };
  const routes = await loadOrganizationCustomerSiteRoutes(
    hostedSiteClient({
      organizationRows: [{
        id: KLAMATH_ORGANIZATION_ID,
        status: "active",
      }],
      siteRows: [duplicate, { ...duplicate }],
    }),
    KLAMATH_ORGANIZATION_ID,
  );
  assertEquals(
    resolveOrganizationCustomerSite(KLAMATH_ORGANIZATION_ID, routes),
    { status: "blocked", code: "ambiguous_customer_site" },
  );
});
