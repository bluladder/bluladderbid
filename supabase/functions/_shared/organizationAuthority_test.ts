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
  const repositoryPayloads: string[] = [];
  const result = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async (selectors) => {
        seen.push(...selectors.map((selector) => selector.keyHash));
        repositoryPayloads.push(JSON.stringify(selectors));
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
  assertEquals(
    repositoryPayloads.some((payload) =>
      payload.includes("assistant-secret-id") ||
      payload.includes("BID.EXAMPLE.COM")
    ),
    false,
  );
  assertEquals(
    result.status === "resolved" &&
      result.evidence.some((evidence) =>
        evidence.includes("assistant-secret-id")
      ),
    false,
  );
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

Deno.test("voice provider authority accepts either Vapi resource and requires every presented resource to map", async () => {
  for (const keyType of ["vapi_assistant", "vapi_phone_number"] as const) {
    const result = await resolveServerOrganizationAuthority(
      repository({
        findMappedSignals: async (selectors) =>
          ok(selectors.map((selector) => ({
            organizationId: ORG_A,
            source: selector.source,
            evidence: `mapped:${selector.keyType}`,
          }))),
      }),
      {
        mapped: [{ source: "provider", keyType, value: `${keyType}-id` }],
      },
    );
    assertEquals(result.status, "resolved");
  }

  const partial = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async () =>
        ok([{
          organizationId: ORG_A,
          source: "provider",
          evidence: "mapped:vapi_assistant",
        }]),
    }),
    {
      mapped: [
        {
          source: "provider",
          keyType: "vapi_assistant",
          value: "assistant-a",
        },
        {
          source: "provider",
          keyType: "vapi_phone_number",
          value: "phone-a",
        },
      ],
    },
  );
  assertEquals(partial, { status: "blocked", code: "missing_authority" });
});

Deno.test("agreeing Vapi resources resolve and conflicting resources fail closed", async () => {
  const request = {
    mapped: [
      {
        source: "provider" as const,
        keyType: "vapi_assistant" as const,
        value: "assistant-a",
      },
      {
        source: "provider" as const,
        keyType: "vapi_phone_number" as const,
        value: "phone-a",
      },
    ],
  };
  const agreeing = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async (selectors) =>
        ok(selectors.map((selector) => ({
          organizationId: ORG_A,
          source: selector.source,
          evidence: `mapped:${selector.keyType}`,
        }))),
    }),
    request,
  );
  assertEquals(agreeing.status, "resolved");

  const conflicting = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async (selectors) =>
        ok(selectors.map((selector, index) => ({
          organizationId: index === 0 ? ORG_A : ORG_B,
          source: selector.source,
          evidence: `mapped:${selector.keyType}`,
        }))),
    }),
    request,
  );
  assertEquals(conflicting, {
    status: "blocked",
    code: "conflicting_authority",
  });
});

Deno.test("mapped Vapi authority still fails closed for an inactive organization", async () => {
  const result = await resolveServerOrganizationAuthority(
    repository({
      findMappedSignals: async (selectors) =>
        ok(selectors.map((selector) => ({
          organizationId: ORG_A,
          source: selector.source,
          evidence: `mapped:${selector.keyType}`,
        }))),
      findOrganizationStatuses: async () => ({
        ok: true,
        statuses: { [ORG_A]: "disabled" },
      }),
    }),
    {
      mapped: [{
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-a",
      }],
    },
  );
  assertEquals(result, {
    status: "blocked",
    code: "inactive_organization",
  });
});

Deno.test("provider values are trimmed before exact lowercase SHA-256 hashing", async () => {
  const hashes: string[] = [];
  const capture = repository({
    findMappedSignals: async (selectors) => {
      hashes.push(selectors[0].keyHash);
      return ok([{
        organizationId: ORG_A,
        source: "provider",
        evidence: "mapped:vapi_assistant",
      }]);
    },
  });
  for (const value of ["provider-id", "  provider-id\t"]) {
    const result = await resolveServerOrganizationAuthority(capture, {
      mapped: [{
        source: "provider",
        keyType: "vapi_assistant",
        value,
      }],
    });
    assertEquals(result.status, "resolved");
  }
  assertEquals(hashes[0], hashes[1]);
  assertEquals(
    hashes[0],
    await (async () => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode("provider-id"),
      );
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    })(),
  );
  assertEquals(/^[0-9a-f]{64}$/.test(hashes[0]), true);
});

Deno.test("email and blank provider selectors never become organization authority", async () => {
  let mappedLookups = 0;
  const repo = repository({
    findMappedSignals: async () => {
      mappedLookups += 1;
      return ok([]);
    },
  });
  assertEquals(
    await resolveServerOrganizationAuthority(repo, {
      mapped: [{
        source: "provider",
        keyType: "email_address",
        value: "caller@example.com",
      }],
    }),
    { status: "blocked", code: "ambiguous_authority" },
  );
  assertEquals(
    await resolveServerOrganizationAuthority(repo, {
      mapped: [{
        source: "provider",
        keyType: "vapi_assistant",
        value: "   ",
      }],
    }),
    { status: "blocked", code: "missing_authority" },
  );
  assertEquals(mappedLookups, 0);
});

Deno.test("a mapped provider cannot conceal a missing conversation resource", async () => {
  const result = await resolveServerOrganizationAuthority(
    repository({
      findResourceSignals: async () => ok([]),
      findMappedSignals: async () =>
        ok([{
          organizationId: ORG_A,
          source: "provider",
          evidence: "mapped:vapi_assistant",
        }]),
    }),
    {
      resources: [{ kind: "conversation", id: "missing" }],
      mapped: [{
        source: "provider",
        keyType: "vapi_assistant",
        value: "assistant-a",
      }],
    },
  );
  assertEquals(result, { status: "blocked", code: "missing_authority" });
});
