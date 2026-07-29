import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("authoritative pricing failure stops before provider mutation", () => {
  const pricingStart = source.indexOf("if (booking.additionalServices || booking.promotion)");
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  assert(pricingStart >= 0 && providerLookup > pricingStart);

  const pricingBoundary = source.slice(pricingStart, providerLookup);
  assertStringIncludes(pricingBoundary, 'code: "PRICING_UNAVAILABLE"');
  assertStringIncludes(pricingBoundary, "status: 503");
  assertEquals(pricingBoundary.includes("failed (non-fatal)"), false);
  assertEquals(pricingBoundary.includes("recompute skipped"), false);
});

Deno.test("local booking persistence failure never returns confirmed success", () => {
  const failureStart = source.indexOf("if (bookingError)");
  const successStart = source.indexOf("const successPayload", failureStart);
  assert(failureStart >= 0 && successStart > failureStart);

  const failureBoundary = source.slice(failureStart, successStart);
  assertStringIncludes(failureBoundary, 'success: false');
  assertStringIncludes(failureBoundary, 'pendingManualConfirmation: true');
  assertStringIncludes(failureBoundary, 'code: "LOCAL_BOOKING_PERSISTENCE_FAILED"');
  assertStringIncludes(failureBoundary, 'status: 202');
  assertStringIncludes(failureBoundary, 'await supabase.rpc("confirm_booking_slot"');
  assertStringIncludes(failureBoundary, "return new Response(");
});

Deno.test("pending idempotent replay preserves accepted-not-confirmed status", () => {
  const replayStart = source.indexOf("if (reserveRes?.idempotent && reserveRes?.result)");
  const replayEnd = source.indexOf("// Slot already actively held", replayStart);
  assert(replayStart >= 0 && replayEnd > replayStart);

  const replayBoundary = source.slice(replayStart, replayEnd);
  assertStringIncludes(replayBoundary, "pendingManualConfirmation === true");
  assertStringIncludes(replayBoundary, "? 202");
  assertStringIncludes(replayBoundary, "status: replayStatus");
});
