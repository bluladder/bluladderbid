// deno-lint-ignore-file require-await

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type OrganizationAuthorityRepository,
  type OrganizationLookupResult,
  resolveServerOrganizationAuthority,
} from "./organizationAuthority.ts";
import type { OrganizationSignal } from "./organizationResolver.ts";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function ok(signals: OrganizationSignal[]): OrganizationLookupResult {
  return { ok: true, signals };
}

function repository(overrides: Partial<OrganizationAuthorityRepository> = {}) {
  const base: OrganizationAuthorityRepository = {
    findResourceSignals: async () => ok([]),
    findMembershipSignals: async () => ok([]),
    findMappedSignals: async () => ok([]),
    findOrganizationStatuses: async (ids) => ({
      ok: true,
      statuses: Object.fromEntries(ids.map((id) => [id, "active"])),
    }),
  };
  return { ...base, ...overrides };
}

Deno.test("organization authority resolves a scoped resource and verifies active status", async () => {
  const result = await resolveServerOrganizationAuthority(
    repository({
      findResourceSignals: async () =>
        ok([{
          organizationId: ORG_A,
          source: "resource",
          evidence: "resource:conversation",
        }]),
    }),
    { resources: [{ kind: "conversation", id: "conversation-selector" }] },
  );
  assertEquals(result, {
    status: "resolved",
    organizationId: ORG_A,
    source: "resource",
    evidence: ["resource:conversation"],
    sensitiveActionsAllowed: true,
  });
});

Deno.test("organization authority blocks missing, ambiguous, conflicting, and inactive evidence", async () => {
  assertEquals(
    await resolveServerOrganizationAuthority(repository(), {}),
    { status: "blocked", code: "missing_authority" },
  );
  assertEquals(
    await resolveServerOrganizationAuthority(
      repository({
        findMembershipSignals: async () => ({ ok: false, reason: "ambiguous" }),
      }),
      {
        membership: { authenticatedUserId: "user-a" },
      },
    ),
    { status: "blocked", code: "ambiguous_authority" },
  );
  assertEquals(
    await resolveServerOrganizationAuthority(
      repository({
        findResourceSignals: async () =>
          ok([{
            organizationId: ORG_A,
            source: "resource",
            evidence: "resource:quote",
          }]),
        findMembershipSignals: async () =>
          ok([{
            organizationId: ORG_B,
            source: "membership",
            evidence: "membership:active",
          }]),
      }),
      {
        resources: [{ kind: "quote", id: "quote-selector" }],
        membership: { authenticatedUserId: "user-b" },
      },
    ),
    { status: "blocked", code: "conflicting_authority" },
  );
  assertEquals(
    await resolveServerOrganizationAuthority(
      repository({
        findResourceSignals: async () =>
          ok([{
            organizationId: ORG_A,
            source: "resource",
            evidence: "resource:booking",
          }]),
        findOrganizationStatuses: async () => ({
          ok: true,
          statuses: { [ORG_A]: "suspended" },
        }),
      }),
      { resources: [{ kind: "booking", id: "booking-selector" }] },
    ),
    { status: "blocked", code: "inactive_organization" },
  );
});

Deno.test("provider and site selectors are hashed before repository lookup", async () => {
  const seen: string[] = [];
  const result = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async (selectors) => {
        seen.push(...selectors.map((selector) => selector.keyHash));
        return ok(selectors.map((selector) => ({
          organizationId: ORG_A,
          source: selector.source,
          evidence: `mapped:${selector.keyType}`,
        })));
      },
    }),
    {
      mapped: [
        {
          source: "provider",
          keyType: "vapi_assistant",
          value: "assistant-secret-id",
        },
        { source: "site", keyType: "hostname", value: "BID.EXAMPLE.COM:443" },
      ],
    },
  );
  assertEquals(result.status, "resolved");
  assertEquals(seen.length, 2);
  assertNotEquals(seen[0], "assistant-secret-id");
  assertEquals(seen.every((hash) => /^[0-9a-f]{64}$/.test(hash)), true);
});

Deno.test("selector source and key vocabulary cannot be crossed", async () => {
  const result = await resolveServerOrganizationAuthority(repository(), {
    mapped: [{
      source: "site",
      keyType: "vapi_assistant",
      value: "untrusted-cross-kind",
    }],
  });
  assertEquals(result, { status: "blocked", code: "ambiguous_authority" });
});

Deno.test("trusted territory is lower precedence and still conflicts with resource authority", async () => {
  const result = await resolveServerOrganizationAuthority(
    repository({
      findResourceSignals: async () =>
        ok([{
          organizationId: ORG_A,
          source: "resource",
          evidence: "resource:customer",
        }]),
    }),
    {
      resources: [{ kind: "customer", id: "customer-selector" }],
      territory: {
        verification: "trusted_territory_rule",
        organizationId: ORG_B,
        ruleId: "rule-b",
      },
    },
  );
  assertEquals(result, { status: "blocked", code: "conflicting_authority" });
});

Deno.test("DFW is available only through the named bounded route and is never sensitive-action authority", async () => {
  assertEquals(
    await resolveServerOrganizationAuthority(repository(), {}),
    { status: "blocked", code: "missing_authority" },
  );
  const result = await resolveServerOrganizationAuthority(repository(), {
    legacy: {
      route: "public_booking_service_area",
      explicitlyAllowed: true,
    },
  });
  assertEquals(result.status, "resolved");
  if (result.status === "resolved") {
    assertEquals(
      result.organizationId,
      "b1addf00-0000-4000-8000-000000000001",
    );
    assertEquals(result.source, "legacy_dfw");
    assertEquals(result.sensitiveActionsAllowed, false);
  }
});

Deno.test("repository failures stay typed and fail closed", async () => {
  assertEquals(
    await resolveServerOrganizationAuthority(
      repository({
        findResourceSignals: async () => ({
          ok: false,
          reason: "lookup_unavailable",
        }),
      }),
      { resources: [{ kind: "conversation", id: "selector" }] },
    ),
    { status: "blocked", code: "lookup_unavailable" },
  );
});
