import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveCustomerByPhone } from "./customerResolver.ts";

function fakeSupabase(rows: unknown[] | null, throwOnQuery = false) {
  return {
    from() {
      return {
        select() { return this; },
        in() { return this; },
        limit() {
          if (throwOnQuery) throw new Error("db down");
          return Promise.resolve({ data: rows, error: null });
        },
      };
    },
  };
}

Deno.test("returns resolved for a single unique customer match", async () => {
  const sb = fakeSupabase([{ id: "cust_1", first_name: "Alex", phone: "+14695551212" }]);
  const r = await resolveCustomerByPhone(sb, "+14695551212");
  assertEquals(r.kind, "resolved");
  if (r.kind === "resolved") {
    assertEquals(r.customer.customerId, "cust_1");
    assertEquals(r.customer.firstName, "Alex");
  }
});

Deno.test("returns ambiguous when multiple distinct customers share the phone", async () => {
  const sb = fakeSupabase([
    { id: "a", first_name: "A", phone: "+14695551212" },
    { id: "b", first_name: "B", phone: "+14695551212" },
  ]);
  const r = await resolveCustomerByPhone(sb, "+14695551212");
  assertEquals(r.kind, "ambiguous");
});

Deno.test("returns not_found when no customer matches", async () => {
  const sb = fakeSupabase([]);
  const r = await resolveCustomerByPhone(sb, "+14695551212");
  assertEquals(r.kind, "not_found");
});

Deno.test("returns not_found on lookup failure (safe fallback)", async () => {
  const sb = fakeSupabase(null, true);
  const r = await resolveCustomerByPhone(sb, "+14695551212");
  assertEquals(r.kind, "not_found");
});

Deno.test("does NOT expose any customer PII in ambiguous result", async () => {
  const sb = fakeSupabase([
    { id: "a", first_name: "A", phone: "+14695551212" },
    { id: "b", first_name: "B", phone: "+14695551212" },
  ]);
  const r = await resolveCustomerByPhone(sb, "+14695551212");
  // ambiguous shape contains only count — no addresses, names, emails.
  const json = JSON.stringify(r);
  assertEquals(json.includes("first_name"), false);
  assertEquals(json.includes("address"), false);
  assertEquals(json.includes("email"), false);
});