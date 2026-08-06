import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveCustomerByPhone,
  verifiedNameMatchesCustomerCandidate,
} from "./customerResolver.ts";

const ORG = "00000000-0000-4000-8000-000000000072";

function fakeSupabase(rows: unknown[] | null, throwOnQuery = false) {
  const filters: Array<[string, unknown]> = [];
  return {
    filters,
    from() {
      return {
        select() {
          return this;
        },
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          return this;
        },
        in(key: string, value: unknown) {
          filters.push([key, value]);
          return this;
        },
        limit() {
          if (throwOnQuery) throw new Error("db down");
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

const customer = (overrides: Record<string, unknown> = {}) => ({
  id: "cust_1",
  organization_id: ORG,
  first_name: "Alex",
  last_name: "Rivera",
  phone: "+14695551212",
  ...overrides,
});

Deno.test("phase7 one exact same-tenant phone match may be verified and reused", async () => {
  const sb = fakeSupabase([customer()]);
  const result = await resolveCustomerByPhone(
    sb,
    ORG,
    "(469) 555-1212",
  );
  assertEquals(result.kind, "resolved");
  if (result.kind !== "resolved") return;
  assertEquals(result.customer.customerId, "cust_1");
  assertEquals(
    await verifiedNameMatchesCustomerCandidate({
      organizationId: ORG,
      phoneE164: "+14695551212",
      suppliedName: "Alex Rivera",
      customer: result.customer,
    }),
    true,
  );
  assertEquals(
    await verifiedNameMatchesCustomerCandidate({
      organizationId: ORG,
      phoneE164: "+14695551212",
      suppliedName: "Different Person",
      customer: result.customer,
    }),
    false,
  );
  assertEquals(sb.filters[0], ["organization_id", ORG]);
});

Deno.test("phase7 shared-phone ambiguity cannot select a customer", async () => {
  const result = await resolveCustomerByPhone(
    fakeSupabase([
      customer({ id: "a" }),
      customer({ id: "b", first_name: "Bailey", last_name: "Rivera" }),
    ]),
    ORG,
    "+14695551212",
  );
  assertEquals(result, { kind: "ambiguous" });
  assertEquals(JSON.stringify(result).includes("Alex"), false);
  assertEquals(JSON.stringify(result).includes("Bailey"), false);
});

Deno.test("phase7 cross-tenant phone matches are invisible", async () => {
  const result = await resolveCustomerByPhone(
    fakeSupabase([
      customer({
        id: "oregon-customer",
        organization_id: "00000000-0000-4000-8000-000000000099",
      }),
    ]),
    ORG,
    "+14695551212",
  );
  assertEquals(result, { kind: "not_found" });
});

Deno.test("phase7 zero matches preserves the new-customer path", async () => {
  assertEquals(
    await resolveCustomerByPhone(fakeSupabase([]), ORG, "+14695551212"),
    { kind: "not_found" },
  );
});

Deno.test("phase7 lookup uncertainty and unverifiable rows fail closed", async () => {
  assertEquals(
    await resolveCustomerByPhone(
      fakeSupabase(null, true),
      ORG,
      "+14695551212",
    ),
    { kind: "unavailable" },
  );
  assertEquals(
    await resolveCustomerByPhone(
      fakeSupabase([customer({ last_name: null })]),
      ORG,
      "+14695551212",
    ),
    { kind: "unverifiable" },
  );
});

Deno.test("phase7 opaque candidate response exposes no customer PII", async () => {
  const result = await resolveCustomerByPhone(
    fakeSupabase([customer()]),
    ORG,
    "+14695551212",
  );
  const serialized = JSON.stringify(result);
  assertEquals(serialized.includes("Alex"), false);
  assertEquals(serialized.includes("Rivera"), false);
  assertEquals(serialized.includes("4695551212"), false);
  assertEquals(serialized.includes("address"), false);
  assertEquals(serialized.includes("email"), false);
  if (result.kind === "resolved") {
    assertNotEquals(result.customer.nameVerificationToken, "Alex Rivera");
  }
});
