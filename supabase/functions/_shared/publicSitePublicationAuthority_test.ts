import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DFW_ORGANIZATION_ID } from "./organizationRouting.ts";
import { resolvePublicSitePublicationAuthority } from "./publicSitePublicationAuthority.ts";

function request(origin?: string): Request {
  return new Request(
    "https://example.supabase.co/functions/v1/public-site-bootstrap",
    {
      headers: origin ? { origin } : {},
    },
  );
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

const organizationId = "b1addf00-0000-4000-8000-000000000003";
const publishedSite = {
  organization_id: organizationId,
  tenant_key: "bluladder-klamath",
  canonical_hostname: "klamath.bluladder.com",
  mapping_status: "active",
  runtime_routing_enabled: true,
  site_published: true,
  customer_traffic_allowed: false,
};
const activeOrganization = { id: organizationId, status: "active" };
const settings = {
  organization_id: organizationId,
  public_name: "BluLadder Klamath",
  branding: { tagline: "Next Level Clean" },
};

Deno.test("public site publication authority rejects unsafe origins", async () => {
  for (
    const origin of [
      undefined,
      "http://klamath.bluladder.com",
      "https://user@klamath.bluladder.com",
      "https://klamath.bluladder.com:8443",
      "https://preview.lovable.app",
      "not a URL",
    ]
  ) {
    const result = await resolvePublicSitePublicationAuthority(
      fakeSupabase({}).client,
      request(origin),
    );
    assertEquals(result.status, "blocked");
  }
});

Deno.test("public site publication authority preserves exact DFW compatibility without database reads", async () => {
  const fake = fakeSupabase({});
  assertEquals(
    await resolvePublicSitePublicationAuthority(
      fake.client,
      request("https://bid.bluladder.com"),
    ),
    {
      status: "resolved",
      organizationId: DFW_ORGANIZATION_ID,
      tenantKey: "bluladder-dfw",
      hostname: "bid.bluladder.com",
      publicName: "BluLadder",
      tagline: "Next Level Clean",
      accessMode: "customer",
      source: "exact_dfw_compatibility",
    },
  );
  assertEquals(fake.reads, []);
});

Deno.test("published Klamath site with customer traffic disabled resolves compliance-only", async () => {
  const fake = fakeSupabase({
    organization_customer_sites: [publishedSite],
    organizations: [activeOrganization],
    organization_settings: [settings],
  });
  const result = await resolvePublicSitePublicationAuthority(
    fake.client,
    request("https://klamath.bluladder.com"),
  );
  assertEquals(result, {
    status: "resolved",
    organizationId,
    tenantKey: "bluladder-klamath",
    hostname: "klamath.bluladder.com",
    publicName: "BluLadder Klamath",
    tagline: "Next Level Clean",
    accessMode: "compliance_only",
    source: "published_customer_site",
  });
  assertEquals(fake.reads.map((read) => read.table), [
    "organization_customer_sites",
    "organizations",
    "organization_settings",
  ]);
});

Deno.test("customer traffic flag changes classification but does not grant frontend runtime authority", async () => {
  const fake = fakeSupabase({
    organization_customer_sites: [{
      ...publishedSite,
      customer_traffic_allowed: true,
    }],
    organizations: [activeOrganization],
    organization_settings: [settings],
  });
  const result = await resolvePublicSitePublicationAuthority(
    fake.client,
    request("https://klamath.bluladder.com"),
  );
  assertEquals(result.status, "resolved");
  if (result.status === "resolved") {
    assertEquals(result.accessMode, "customer");
    assertFalse("contact" in result);
    assertFalse("provider" in result);
  }
});

Deno.test("unpublished, inactive, missing, duplicate, and malformed Klamath evidence fails closed", async () => {
  const cases: Array<Record<string, unknown[]>> = [
    {},
    {
      organization_customer_sites: [{
        ...publishedSite,
        site_published: false,
      }],
    },
    {
      organization_customer_sites: [publishedSite, publishedSite],
    },
    {
      organization_customer_sites: [publishedSite],
      organizations: [{ ...activeOrganization, status: "provisioning" }],
      organization_settings: [settings],
    },
    {
      organization_customer_sites: [publishedSite],
      organizations: [activeOrganization],
      organization_settings: [{ ...settings, branding: {} }],
    },
  ];
  for (const rows of cases) {
    const result = await resolvePublicSitePublicationAuthority(
      fakeSupabase(rows).client,
      request("https://klamath.bluladder.com"),
    );
    assertEquals(result.status, "blocked");
  }
});
