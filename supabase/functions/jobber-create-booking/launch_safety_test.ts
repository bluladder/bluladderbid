import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("customer and property lineage validation precedes provider mutation", () => {
  const validationStart = source.indexOf(
    "validatePublicBookingCustomer(booking.customer)",
  );
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  assert(validationStart >= 0 && providerLookup > validationStart);

  assertStringIncludes(source, "clientProperties(first: 50)");
  assertStringIncludes(source, "findMatchingJobberProperties(");
  assertStringIncludes(
    source,
    'code: "JOBBER_CUSTOMER_OR_PROPERTY_LOOKUP_UNAVAILABLE"',
  );
  assertStringIncludes(source, "resolveJobberClientByVerifiedContact(");
  assertStringIncludes(source, "firstName");
  assertStringIncludes(source, "lastName");
  assertStringIncludes(source, "phones {");
  assertEquals(source.includes("clientProperties(first: 1)"), false);
  assertEquals(source.includes('city: addressParts.city || "Austin"'), false);
  assertEquals(
    source.includes('postalCode: addressParts.postalCode || "78701"'),
    false,
  );
});

Deno.test("canonical service-area decision precedes every authoritative booking write", () => {
  const replayLookup = source.indexOf('.from("slot_reservations")');
  const organizationResolution = source.indexOf(
    "await resolvePublicBookingOrganization(",
  );
  const areaValidation = source.indexOf("await validateServiceArea(");
  const areaDecision = source.indexOf("evaluatePublicBookingServiceArea(");
  const reservation = source.indexOf('supabase.rpc("reserve_booking_slot"');
  const customerLookup = source.indexOf(
    'console.log("Searching for existing Jobber client by email"',
  );
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
  const responseStart = source.indexOf(
    "=== Booking creation completed successfully ===",
  );
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
  const pricingStart = source.indexOf(
    "if (booking.additionalServices || booking.promotion)",
  );
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  assert(pricingStart >= 0 && providerLookup > pricingStart);

  const pricingBoundary = source.slice(pricingStart, providerLookup);
  assertStringIncludes(pricingBoundary, 'code: "PRICING_UNAVAILABLE"');
  assertStringIncludes(pricingBoundary, "status: 503");
  assertEquals(pricingBoundary.includes("failed (non-fatal)"), false);
  assertEquals(pricingBoundary.includes("recompute skipped"), false);
});

Deno.test("local booking persistence failure never returns confirmed success", () => {
  const failureStart = source.indexOf(
    "if (bookingError || canonicalBookingRecordMismatch)",
  );
  const successStart = source.indexOf("const successPayload", failureStart);
  assert(failureStart >= 0 && successStart > failureStart);

  const failureBoundary = source.slice(failureStart, successStart);
  assertStringIncludes(failureBoundary, "success: false");
  assertStringIncludes(failureBoundary, "pendingManualConfirmation: true");
  assertStringIncludes(
    failureBoundary,
    'code: "LOCAL_BOOKING_PERSISTENCE_FAILED"',
  );
  assertStringIncludes(failureBoundary, "status: 202");
  assertStringIncludes(
    source,
    "bookingRecord.reference_number !== referenceNumber",
  );
  assertStringIncludes(source, 'bookingRecord.status !== "scheduled"');
  assertStringIncludes(
    failureBoundary,
    'await supabase.rpc("confirm_booking_slot"',
  );
  assertStringIncludes(failureBoundary, "return new Response(");
});

Deno.test("provider mutations run once behind a protected reservation", () => {
  const reservation = source.indexOf('supabase.rpc("reserve_booking_slot"');
  const protection = source.indexOf("protectReservationForExecution(");
  const providerWrapper = source.indexOf("const runProviderMutation");
  const firstMutation = source.indexOf(
    "await runProviderMutation<",
    providerWrapper,
  );
  assert(reservation >= 0 && protection > reservation);
  assert(providerWrapper > protection && firstMutation > providerWrapper);
  assertEquals(
    source.slice(providerWrapper).includes("await jobberGraphQLMutation<"),
    false,
  );
  assertStringIncludes(
    source,
    "Leaving booking reservation protected after an unsettled provider mutation",
  );
  assertStringIncludes(source, "providerMutationAttempted");
  assertStringIncludes(source, "unprotectReservationAfterFailure(");
});

Deno.test("canonical booking consumes quote duration without a static re-derivation", () => {
  assertStringIncludes(source, "resolveAuthoritativeDuration(engineResult)");
  assertStringIncludes(
    source,
    "scheduledIntervalMinutes(booking.scheduledStart, booking.scheduledEnd)",
  );
  assertEquals(source.includes("calculateBookingDuration("), false);
  assertEquals(source.includes("SERVICE_DURATION"), false);
  assertEquals(source.includes("DEFAULT_DURATION"), false);
});

Deno.test("exact crew, quote versions, and provider identities gate booking", () => {
  assertStringIncludes(source, 'code: "CREW_AUTHORITY_MISMATCH"');
  assertStringIncludes(source, "sameStringArray(returnedTechnicianIds");
  assertStringIncludes(source, "engineResult.engineVersion ===");
  assertStringIncludes(source, "engineResult.ruleVersion ===");
  assertStringIncludes(source, '"JOBBER_CLIENT_IDENTITY_AMBIGUOUS"');
  assertStringIncludes(source, '"JOBBER_CLIENT_IDENTITY_CONFLICT"');
  assertStringIncludes(source, '.is("jobber_client_id", null)');
  assertStringIncludes(source, 'code: "JOBBER_CLIENT_LINK_CONFLICT"');
  assertStringIncludes(source, 'code: "JOBBER_PROPERTY_LINEAGE_MISMATCH"');
  assertStringIncludes(source, 'code: "JOBBER_PROPERTY_IDENTITY_AMBIGUOUS"');
});

Deno.test("visit failure claims manual review only after durable intervention persistence", () => {
  const visitFailureStart = source.indexOf("if (!jobberVisitId)");
  const nextBookingWrite = source.indexOf(
    "// Create booking record in Supabase",
    visitFailureStart,
  );
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
  const replayStart = source.indexOf(
    'if (reservationDecision.action === "replay")',
  );
  const replayEnd = source.indexOf(
    'if (reservationDecision.action === "idempotency_key_reused")',
    replayStart,
  );
  assert(replayStart >= 0 && replayEnd > replayStart);

  const replayBoundary = source.slice(replayStart, replayEnd);
  assertStringIncludes(replayBoundary, "bookingReplayHttpStatus(replayResult)");
  assertStringIncludes(replayBoundary, "reservationDecision.result");
  assertStringIncludes(replayBoundary, "status: replayStatus");
});

Deno.test("exact durable replay precedes mutable voice lineage and provider work", () => {
  const staticContract = source.indexOf(
    "await validateCanonicalVoiceBookingPayload(",
  );
  const replayLookup = source.indexOf('.from("slot_reservations")');
  const dynamicLineage = source.indexOf(
    "await validateCanonicalVoiceLineage(supabase, booking)",
  );
  const providerLookup = source.indexOf('console.log("Looking up technician:"');
  assert(
    staticContract >= 0 && replayLookup > staticContract &&
      dynamicLineage > replayLookup && providerLookup > dynamicLineage,
  );
});

Deno.test("provider payload and mutation responses remain exact", () => {
  assertStringIncludes(source, "buildJobberBookingLineItems({");
  assertStringIncludes(source, "jobberBookingLineItemsTotal(");
  assertStringIncludes(source, '"client_create_malformed"');
  assertStringIncludes(source, '"property_create_malformed"');
  assertStringIncludes(source, '"job_create_malformed"');
  assertStringIncludes(source, '"visit_create_malformed"');
  assertStringIncludes(source, "createdVisits.length > 1");
});
