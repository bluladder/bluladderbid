import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(
  new URL("../public-site-bootstrap/index.ts", import.meta.url),
);

Deno.test("public site bootstrap delegates hostname authority and returns public-safe fields only", () => {
  for (
    const fragment of [
      "resolvePublicSitePublicationAuthority",
      "tenantKey: authority.tenantKey",
      "publicName: authority.publicName",
      "tagline: authority.tagline",
      "accessMode: authority.accessMode",
      "customerRuntimeReady: false",
      '"/privacy"',
      '"/terms"',
      '"/contact"',
      "publicContactReady: false",
    ]
  ) {
    assertStringIncludes(source, fragment);
  }

  for (
    const forbidden of [
      "organizationId: authority.organizationId",
      "credential",
      "destination",
      "providerId",
      "customer_traffic_allowed: true",
      "runtime_routing_enabled: true",
    ]
  ) {
    assertEquals(source.includes(forbidden), false);
  }
});
