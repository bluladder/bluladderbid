import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

Deno.test("recurring service request uses canonical service-area gate before writes", () => {
  const areaValidation = source.indexOf("await validateServiceArea(");
  const areaDecision = source.indexOf("evaluatePublicBookingServiceArea(");
  const idempotencyLookup = source.indexOf("// ---- Idempotent replay:");
  const organizationResolution = source.indexOf(
    "await resolvePublicBookingOrganization(",
  );
  const pricing = source.indexOf("await loadPricing(");
  const customerWrite = source.indexOf('.from("customers")');
  const quoteWrite = source.indexOf(".insert(insertRow)");
  const jobberWrite = source.indexOf("jobberGraphQL<");
  const campaignEvent = source.indexOf("await emitBookingCompleted(");

  assert(areaValidation >= 0);
  assert(areaDecision > areaValidation);
  assert(
    organizationResolution >= 0 &&
      idempotencyLookup < organizationResolution,
  );
  assert(idempotencyLookup >= 0 && idempotencyLookup < areaValidation);
  assert(organizationResolution < areaValidation);
  for (
    const laterBoundary of [
      pricing,
      customerWrite,
      quoteWrite,
      jobberWrite,
      campaignEvent,
    ]
  ) {
    assert(laterBoundary > areaDecision);
  }

  assertStringIncludes(source, "hasAttemptedOrganizationOverride(b)");
  assertStringIncludes(source, '"ORGANIZATION_OVERRIDE_REJECTED"');
  assertStringIncludes(source, "code: serviceAreaDecision.code");
  assertStringIncludes(source, '"service_area_ineligible"');
  assertStringIncludes(source, '"service_area_ambiguous"');
  assertStringIncludes(source, '"service_area_unavailable"');
  assertStringIncludes(source, "No request or notification was created.");
  assertStringIncludes(source, "_requestFingerprint: requestFingerprint");
  assertStringIncludes(source, '"IDEMPOTENCY_KEY_REUSED"');
  assertStringIncludes(source, "...organizationWriteFields");
  assertStringIncludes(source, '"organization_id"');
  assertStringIncludes(source, "recordServiceAreaIntervention(");
  assertStringIncludes(source, '"service_area_intervention_failed"');
});
