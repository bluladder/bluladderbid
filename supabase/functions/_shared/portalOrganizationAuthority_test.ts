import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import {
  normalizePortalOrigin,
  portalOrganizationMatches,
  resolvePortalOrganizationAuthority,
} from "./portalOrganizationAuthority.ts";
import { DFW_ORGANIZATION_ID } from "./organizationRouting.ts";

function request(origin?: string): Request {
  return new Request("https://example.supabase.co/functions/v1/portal", {
    headers: origin ? { origin } : {},
  });
}

function fakeSupabase(rows: Record<string, unknown[]>) {
  const reads: Array<{ table: string; field: string; value: unknown }> = [];
  return {
    reads,
    client: {
      from(table: string) {
        let field = "";
        let value: unknown;
        return {
          select() {
            return this;
          },
          eq(nextField: string, nextValue: unknown) {
            field = nextField;
            value = nextValue;
            return this;
          },
          limit() {
            reads.push({ table, field, value });
            return Promise.resolve({ data: rows[table] ?? [], error: null });
          },
        };
      },
    },
  };
}

Deno.test("portal authority: rejects missing, insecure, credentialed, and preview origins", () => {
  assertEquals(normalizePortalOrigin(null), {
    ok: false,
    code: "missing_origin",
  });
  for (
    const origin of [
      "http://bid.bluladder.com",
      "https://user@example.com",
      "https://example.com:8443",
      "https://bluladderbid.lovable.app",
      "not a URL",
    ]
  ) {
    assertEquals(normalizePortalOrigin(origin).ok, false);
  }
});

Deno.test("portal authority: exact canonical DFW origin preserves compatibility without a database fallback", async () => {
  const fake = fakeSupabase({});
  const result = await resolvePortalOrganizationAuthority(
    fake.client,
    request("https://bid.bluladder.com"),
  );
  assertEquals(result, {
    status: "resolved",
    organizationId: DFW_ORGANIZATION_ID,
    hostname: "bid.bluladder.com",
    source: "exact_dfw_compatibility",
  });
  assertEquals(fake.reads, []);
});

Deno.test("portal authority: provisioning Klamath site remains blocked before organization lookup", async () => {
  const fake = fakeSupabase({
    organization_customer_sites: [{
      organization_id: "b1addf00-0000-4000-8000-000000000003",
      canonical_hostname: "klamath.bluladder.com",
      mapping_status: "provisioning",
      runtime_routing_enabled: false,
      site_published: false,
      customer_traffic_allowed: false,
    }],
  });
  assertEquals(
    await resolvePortalOrganizationAuthority(
      fake.client,
      request("https://klamath.bluladder.com"),
    ),
    { status: "blocked", code: "customer_site_unavailable" },
  );
  assertEquals(fake.reads.map((read) => read.table), [
    "organization_customer_sites",
  ]);
});

Deno.test("portal authority: active exact site and active organization resolve", async () => {
  const organizationId = "b1addf00-0000-4000-8000-000000000003";
  const fake = fakeSupabase({
    organization_customer_sites: [{
      organization_id: organizationId,
      canonical_hostname: "klamath.bluladder.com",
      mapping_status: "active",
      runtime_routing_enabled: true,
      site_published: true,
      customer_traffic_allowed: true,
    }],
    organizations: [{ id: organizationId, status: "active" }],
  });
  assertEquals(
    await resolvePortalOrganizationAuthority(
      fake.client,
      request("https://klamath.bluladder.com"),
    ),
    {
      status: "resolved",
      organizationId,
      hostname: "klamath.bluladder.com",
      source: "active_customer_site",
    },
  );
});

Deno.test("portal authority: missing, duplicate, inactive, and read-error states fail closed", async () => {
  const organizationId = "b1addf00-0000-4000-8000-000000000003";
  const activeSite = {
    organization_id: organizationId,
    canonical_hostname: "klamath.bluladder.com",
    mapping_status: "active",
    runtime_routing_enabled: true,
    site_published: true,
    customer_traffic_allowed: true,
  };
  const states: Array<Record<string, unknown[]>> = [
    {},
    { organization_customer_sites: [activeSite, activeSite] },
    {
      organization_customer_sites: [activeSite],
      organizations: [{ id: organizationId, status: "provisioning" }],
    },
  ];
  for (
    const rows of states
  ) {
    const result = await resolvePortalOrganizationAuthority(
      fakeSupabase(rows).client,
      request("https://klamath.bluladder.com"),
    );
    assertEquals(result.status, "blocked");
  }
});

Deno.test("portal authority: organization comparisons are exact and case-normalized", () => {
  assertEquals(
    portalOrganizationMatches(
      "B1ADDF00-0000-4000-8000-000000000003",
      "b1addf00-0000-4000-8000-000000000003",
    ),
    true,
  );
  assertFalse(
    portalOrganizationMatches(
      "b1addf00-0000-4000-8000-000000000003",
      DFW_ORGANIZATION_ID,
    ),
  );
});
