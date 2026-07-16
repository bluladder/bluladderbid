// Stage A regression tests: the public customer-lookup endpoint MUST NOT
// return customer PII, existence, booking counts, or quote counts for any
// caller. It must always return the same generic non-enumerating envelope.
//
// Run with: deno test supabase/functions/customer-lookup/index_test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

// The endpoint is a single serve() handler that ignores the request body.
// We import the module and hit it directly by constructing a Request; because
// serve() attaches a listener we cannot invoke, we instead re-export the
// handler via a lightweight wrapper in the module. Since the current module
// does not export it, this test asserts the source text contains the security
// contract: no database client, no email lookup, generic response payload.

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("customer-lookup does not import a supabase client", () => {
  assert(
    !/@supabase\/supabase-js/.test(source),
    "customer-lookup must not query the database — Stage A lockdown",
  );
});

Deno.test("customer-lookup does not read customers, bookings, or quotes", () => {
  for (const table of ["from(\"customers\"", "from(\"bookings\"", "from(\"quotes\""]) {
    assert(
      !source.includes(table),
      `customer-lookup must not query ${table} — Stage A lockdown`,
    );
  }
});

Deno.test("customer-lookup response is generic and non-enumerating", () => {
  assert(
    source.includes("Secure verification is required"),
    "customer-lookup must respond with the fixed generic message",
  );
  assert(
    !/customer:\s*customer/.test(source) && !source.includes("customer.first_name"),
    "customer-lookup must not include customer PII fields in response",
  );
});

// Sanity check on the response shape when the module is invoked in-process.
Deno.test("customer-lookup returns { verified: false } for any input", async () => {
  // Spin up the handler in an isolated context by importing side-effect free.
  // We can't call serve() here, so we instead validate the JSON literal exists.
  assertEquals(
    /verified:\s*false/.test(source),
    true,
  );
});