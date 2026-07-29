import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("recurring intake validation happens before local or Jobber writes", () => {
  const validationStart = source.indexOf("validatePublicBookingCustomer(rawCustomer)");
  const clientCreate = source.indexOf("// Find or create Jobber client.");
  assert(validationStart >= 0 && clientCreate > validationStart);
  assertStringIncludes(source, 'code: customerValidation.code');
});

Deno.test("recurring property selection matches the submitted address", () => {
  assertStringIncludes(source, "clientProperties(first: 50)");
  assertStringIncludes(source, "findMatchingJobberProperty(");
  assertStringIncludes(source, 'code: "PROPERTY_LOOKUP_UNAVAILABLE"');
  assertEquals(source.includes("clientProperties(first: 1)"), false);
  assertEquals(source.includes('city: addr.city || "Austin"'), false);
  assertEquals(source.includes('postalCode: addr.postalCode || "78701"'), false);
});

Deno.test("unconfirmed idempotent replay never reports provider success", () => {
  const replayStart = source.indexOf("// ---- Idempotent replay");
  const pricingStart = source.indexOf("// ---- 1) Load current published pricing");
  assert(replayStart >= 0 && pricingStart > replayStart);
  const replayBoundary = source.slice(replayStart, pricingStart);

  assertStringIncludes(replayBoundary, "if (!existing.jobber_quote_id)");
  assertStringIncludes(replayBoundary, 'status: "pending_provider_confirmation"');
  assertStringIncludes(replayBoundary, 'code: "PRIOR_JOBBER_RESULT_UNCONFIRMED"');
  assertStringIncludes(replayBoundary, "}, 202)");
});
