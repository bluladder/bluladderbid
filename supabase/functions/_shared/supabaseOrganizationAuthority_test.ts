import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseOrganizationAuthorityRepository } from "./supabaseOrganizationAuthority.ts";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

interface QueryLog {
  table: string;
  filters: Array<{ operator: "eq" | "in"; key: string; value: unknown }>;
}

function fakeSupabase(rows: Record<string, Array<Record<string, unknown>>>) {
  const queries: QueryLog[] = [];
  return {
    queries,
    client: {
      from(table: string) {
        const log: QueryLog = { table, filters: [] };
        queries.push(log);
        const chain = {
          select: () => chain,
          eq(key: string, value: unknown) {
            log.filters.push({ operator: "eq", key, value });
            return chain;
          },
          in(key: string, value: unknown) {
            log.filters.push({ operator: "in", key, value });
            return chain;
          },
          limit: () => chain,
          then(
            resolve: (
              result: {
                data: Array<Record<string, unknown>>;
                error: null;
              },
            ) => unknown,
          ) {
            return Promise.resolve({ data: rows[table] ?? [], error: null })
              .then(resolve);
          },
        };
        return chain;
      },
    },
  };
}

Deno.test("Supabase authority adapter accepts only active hashed provider mappings", async () => {
  const fake = fakeSupabase({
    organization_resolution_keys: [{ organization_id: ORG_A }],
  });
  const repository = createSupabaseOrganizationAuthorityRepository(fake.client);
  const result = await repository.findMappedSignals([{
    source: "provider",
    keyType: "vapi_assistant",
    keyHash: "f".repeat(64),
  }]);
  assertEquals(result, {
    ok: true,
    signals: [{
      organizationId: ORG_A,
      source: "provider",
      evidence: "mapped:vapi_assistant",
    }],
  });
  assertEquals(fake.queries, [{
    table: "organization_resolution_keys",
    filters: [
      { operator: "eq", key: "key_type", value: "vapi_assistant" },
      { operator: "eq", key: "key_hash", value: "f".repeat(64) },
      { operator: "eq", key: "status", value: "active" },
    ],
  }]);
});

Deno.test("Supabase authority adapter rejects ambiguous active memberships", async () => {
  const fake = fakeSupabase({
    organization_memberships: [
      { organization_id: ORG_A },
      { organization_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ],
  });
  const repository = createSupabaseOrganizationAuthorityRepository(fake.client);
  const result = await repository.findMembershipSignals({
    authenticatedUserId: "user-a",
  });
  assertEquals(result, { ok: false, reason: "ambiguous" });
  assertEquals(fake.queries[0].filters, [
    { operator: "eq", key: "user_id", value: "user-a" },
    { operator: "eq", key: "status", value: "active" },
  ]);
});

Deno.test("Supabase authority adapter reads organization status from the control plane", async () => {
  const fake = fakeSupabase({
    organizations: [{ id: ORG_A, status: "active" }],
  });
  const repository = createSupabaseOrganizationAuthorityRepository(fake.client);
  assertEquals(await repository.findOrganizationStatuses([ORG_A]), {
    ok: true,
    statuses: { [ORG_A]: "active" },
  });
  assertEquals(fake.queries[0].filters, [{
    operator: "in",
    key: "id",
    value: [ORG_A],
  }]);
});
