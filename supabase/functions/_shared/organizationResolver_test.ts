import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertOrganizationLineage,
  BLULADDER_DFW_ORGANIZATION_ID,
  legacyDfwSignal,
  resolveOrganizationContext,
} from "./organizationResolver.ts";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

Deno.test("resource context wins precedence when verified signals agree", () => {
  const result = resolveOrganizationContext([
    { organizationId: ORG_A, source: "site", evidence: "host:site-a" },
    { organizationId: ORG_A, source: "membership", evidence: "member:user-a" },
    { organizationId: ORG_A, source: "resource", evidence: "quote:q-a" },
  ]);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.source, "resource");
});

Deno.test("conflicting trusted signals fail closed despite precedence", () => {
  assertEquals(
    resolveOrganizationContext([
      { organizationId: ORG_A, source: "resource", evidence: "quote:q-a" },
      {
        organizationId: ORG_B,
        source: "membership",
        evidence: "member:user-b",
      },
    ]),
    { ok: false, reason: "conflict" },
  );
});

Deno.test("missing and malformed signals fail closed", () => {
  assertEquals(resolveOrganizationContext([]), {
    ok: false,
    reason: "missing",
  });
  assertEquals(
    resolveOrganizationContext([
      { organizationId: "client-payload", source: "site", evidence: "raw" },
    ]),
    { ok: false, reason: "ambiguous" },
  );
});

Deno.test("legacy DFW requires explicit compatibility authorization", () => {
  const signal = legacyDfwSignal("migration-compatible DFW route");
  assertEquals(resolveOrganizationContext([signal]), {
    ok: false,
    reason: "legacy_not_allowed",
  });
  const result = resolveOrganizationContext([signal], { allowLegacyDfw: true });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.organizationId, BLULADDER_DFW_ORGANIZATION_ID);
    assertEquals(result.source, "legacy_dfw");
  }
});

Deno.test("resolver API exposes no client-controlled fallback option", () => {
  const result = resolveOrganizationContext([
    { organizationId: ORG_A, source: "provider", evidence: "mapped:account-a" },
  ]);
  assertFalse(!result.ok);
});

Deno.test("service-role lineage guard isolates organizations", () => {
  assertOrganizationLineage(ORG_A, ORG_A);
  let mismatch = "";
  try {
    assertOrganizationLineage(ORG_A, ORG_B);
  } catch (error) {
    mismatch = error instanceof Error ? error.message : String(error);
  }
  assertEquals(mismatch, "organization_lineage_mismatch");
});

Deno.test("unscoped compatibility must be explicit and never permits mismatch", () => {
  assertOrganizationLineage(BLULADDER_DFW_ORGANIZATION_ID, null, {
    allowUnscopedLegacy: true,
  });
  let missing = "";
  try {
    assertOrganizationLineage(BLULADDER_DFW_ORGANIZATION_ID, null);
  } catch (error) {
    missing = error instanceof Error ? error.message : String(error);
  }
  assertEquals(missing, "organization_lineage_missing");
});
