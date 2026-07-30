import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("customer and property lineage validation precedes provider mutation", () => {
  const validationStart = source.indexOf("validatePublicBookingCustomer(booking.customer)");
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  assert(validationStart >= 0 && providerLookup > validationStart);

  assertStringIncludes(source, "clientProperties(first: 50)");
  assertStringIncludes(source, "findMatchingJobberProperty(");
  assertStringIncludes(source, 'code: "PROPERTY_LOOKUP_UNAVAILABLE"');
  assertEquals(source.includes("clientProperties(first: 1)"), false);
  assertEquals(source.includes('city: addressParts.city || "Austin"'), false);
  assertEquals(source.includes('postalCode: addressParts.postalCode || "78701"'), false);
});

Deno.test("canonical service-area decision precedes every authoritative booking write", () => {
  const replayLookup = source.indexOf(".from(\"slot_reservations\")");
  const organizationResolution = source.indexOf(
    "await resolvePublicBookingOrganization(",
  );
  const areaValidation = source.indexOf("await validateServiceArea(");
  const areaDecision = source.indexOf("evaluatePublicBookingServiceArea(");
  const reservation = source.indexOf('supabase.rpc("reserve_booking_slot"');
  const customerLookup = source.indexOf('console.log("Searching for existing Jobber client by email"');
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  const confirmationEmail = source.indexOf("sendBookingConfirmationEmails(");

  assert(areaValidation >= 0);
  assert(replayLookup >= 0 && replayLookup < organizationResolution);
  assert(organizationResolution < areaValidation);
  assert(replayLookup >= 0 && replayLookup < areaValidation);
  assert(areaDecision > areaValidation);
  assert(reservation > areaDecision);
  assert(customerLookup > areaDecision);
  assert(providerLookup > areaDecision);
  assert(confirmationEmail > areaDecision);
  assertStringIncludes(source, '"ORGANIZATION_OVERRIDE_REJECTED"');
  assertStringIncludes(source, "code: serviceAreaDecision.code");
  assertStringIncludes(source, "requestFingerprintMatches(");
  assertStringIncludes(source, '"IDEMPOTENCY_KEY_REUSED"');
  assertStringIncludes(source, "...organizationWriteFields");
  assertStringIncludes(source, '"organization_id"');
  assertStringIncludes(source, "recordServiceAreaIntervention(");
  assertStringIncludes(source, '"SERVICE_AREA_INTERVENTION_FAILED"');
});

Deno.test("protected synthetic booking suppresses every post-booking communication side effect", () => {
  const successStart = source.indexOf("const successPayload");
  const responseStart = source.indexOf("=== Booking creation completed successfully ===");
  assert(successStart >= 0 && responseStart > successStart);
  const successBoundary = source.slice(successStart, responseStart);

  assertStringIncludes(successBoundary, "communicationsSuppressed: true");
  assertStringIncludes(
    successBoundary,
    "bookingRecord?.id && !protectedSyntheticRunId",
  );
  assertStringIncludes(
    successBoundary,
    "bookingRecord?.id && jobberVisitId && !protectedSyntheticRunId",
  );
  assertStringIncludes(
    successBoundary,
    'event: "protected_booking_test_communications_suppressed"',
  );
  assertStringIncludes(successBoundary, "campaign_event_suppressed: true");
});

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

Deno.test("visit failure claims manual review only after durable intervention persistence", () => {
  const visitFailureStart = source.indexOf("if (!jobberVisitId)");
  const nextBookingWrite = source.indexOf("// Create booking record in Supabase", visitFailureStart);
  assert(visitFailureStart >= 0 && nextBookingWrite > visitFailureStart);

  const boundary = source.slice(visitFailureStart, nextBookingWrite);
  assertStringIncludes(boundary, "naBookingError || !naBooking?.id");
  assertStringIncludes(boundary, '"intervention_record_failed"');
  assertStringIncludes(boundary, '"intervention_recorded"');
  assertStringIncludes(boundary, "_requestFingerprint: requestFingerprint");
  assertStringIncludes(boundary, "Please do not resubmit this time slot");
  assertStringIncludes(boundary, "Your request was recorded for manual review");
  assertEquals(boundary.includes("team has been notified"), false);
});

Deno.test("pending idempotent replay preserves accepted-not-confirmed status", () => {
  const replayStart = source.indexOf("if (reserveRes?.idempotent && reserveRes?.result)");
  const replayEnd = source.indexOf("// Slot already actively held", replayStart);
  assert(replayStart >= 0 && replayEnd > replayStart);

  const replayBoundary = source.slice(replayStart, replayEnd);
  assertStringIncludes(replayBoundary, "bookingReplayHttpStatus(replayResult)");
  assertStringIncludes(replayBoundary, "requestFingerprintMatches(");
  assertStringIncludes(replayBoundary, "publicReplayResult(");
  assertStringIncludes(replayBoundary, "status: replayStatus");
});
