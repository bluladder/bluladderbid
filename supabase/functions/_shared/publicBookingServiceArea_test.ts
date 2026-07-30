import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { ServiceAddress } from "./publicBookingCustomer.ts";
import {
  evaluatePublicBookingServiceArea,
  hasAttemptedOrganizationOverride,
  PUBLIC_BOOKING_ORGANIZATION_ID,
} from "./publicBookingServiceArea.ts";
import type { ServiceAreaResult } from "./serviceArea.ts";

const submitted: ServiceAddress = {
  street1: "123 Main St",
  city: "Aubrey",
  province: "TX",
  postalCode: "76227",
  country: "US",
};

function result(
  patch: Partial<ServiceAreaResult> = {},
): ServiceAreaResult {
  return {
    status: "eligible",
    streetNumber: "123",
    route: "Main Street",
    city: "Aubrey",
    county: "Denton",
    state: "TX",
    postalCode: "76227",
    countryCode: "US",
    customerMessage: "Eligible",
    ...patch,
  };
}

Deno.test("eligible DFW provider result survives case and whitespace normalization", () => {
  assertEquals(
    evaluatePublicBookingServiceArea(
      { ...submitted, city: "  aubrey ", province: "tx" },
      result({ city: "AUBREY", state: " TX ", postalCode: "76227-1234" }),
    ),
    {
      status: "eligible",
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
      normalizedAddress: {
        city: "AUBREY",
        state: "TX",
        postalCode: "76227-1234",
        countryCode: "US",
      },
    },
  );
});

Deno.test("known Oregon and unsupported Texas geography are ineligible", () => {
  for (
    const knownOutside of [
      result({
        status: "manual_review_required",
        reasonCode: "outside_primary_service_area",
        city: "Portland",
        state: "OR",
        postalCode: "97201",
      }),
      result({
        status: "manual_review_required",
        reasonCode: "outside_primary_service_area",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
      }),
    ]
  ) {
    assertEquals(evaluatePublicBookingServiceArea(submitted, knownOutside), {
      status: "ineligible",
      code: "OUTSIDE_DFW_SERVICE_AREA",
      retryable: false,
    });
  }
});

Deno.test("an erroneously eligible provider result cannot expand DFW to Oregon or Austin", () => {
  for (
    const outside of [
      {
        submitted: {
          ...submitted,
          city: "Portland",
          province: "OR",
          postalCode: "97201",
        },
        resolved: result({
          city: "Portland",
          county: "Multnomah",
          state: "OR",
          postalCode: "97201",
        }),
      },
      {
        submitted: {
          ...submitted,
          city: "Austin",
          postalCode: "78701",
        },
        resolved: result({
          city: "Austin",
          county: "Travis",
          postalCode: "78701",
        }),
      },
    ]
  ) {
    assertEquals(
      evaluatePublicBookingServiceArea(outside.submitted, outside.resolved),
      {
        status: "ineligible",
        code: "OUTSIDE_DFW_SERVICE_AREA",
        retryable: false,
      },
    );
  }
});

Deno.test("configured manual-review geography stays distinct from known exclusion", () => {
  assertEquals(
    evaluatePublicBookingServiceArea(
      submitted,
      result({
        status: "manual_review_required",
        reasonCode: "configured_manual_review_county",
      }),
    ),
    {
      status: "manual_review",
      code: "SERVICE_AREA_MANUAL_REVIEW",
      retryable: false,
    },
  );
});

Deno.test("missing, malformed, or conflicting provider geography is ambiguous", () => {
  for (
    const ambiguous of [
      result({ status: "address_incomplete", postalCode: undefined }),
      result({ postalCode: undefined }),
      result({ postalCode: "not-a-zip" }),
      result({ city: "Denton" }),
      result({ postalCode: "76201" }),
      result({ countryCode: "CA" }),
      result({ streetNumber: "125" }),
      result({ route: "Oak Street" }),
    ]
  ) {
    assertEquals(evaluatePublicBookingServiceArea(submitted, ambiguous), {
      status: "ambiguous",
      code: "ADDRESS_AMBIGUOUS",
      retryable: true,
    });
  }
});

Deno.test("geocoder timeout and hard failure fail closed as retryable provider uncertainty", () => {
  for (const reason of ["geocoder_timeout", "geocoder_unavailable"]) {
    assertEquals(
      evaluatePublicBookingServiceArea(
        submitted,
        result({ status: "validation_unavailable", reason }),
      ),
      {
        status: "provider_unavailable",
        code: "GEOCODER_UNAVAILABLE",
        retryable: true,
      },
    );
  }
});

Deno.test("missing service-area configuration is distinct from provider failure", () => {
  assertEquals(
    evaluatePublicBookingServiceArea(
      submitted,
      result({
        status: "validation_unavailable",
        reason: "service_area_configuration_unavailable",
      }),
    ),
    {
      status: "configuration_unavailable",
      code: "SERVICE_AREA_CONFIGURATION_UNAVAILABLE",
      retryable: true,
    },
  );
});

Deno.test("public callers cannot select or override organization identity", () => {
  assertEquals(hasAttemptedOrganizationOverride({}), false);
  assertEquals(
    hasAttemptedOrganizationOverride({
      organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
    }),
    true,
  );
  assertEquals(
    hasAttemptedOrganizationOverride({ organization_id: null }),
    true,
  );
  assertEquals(hasAttemptedOrganizationOverride({ organization: "dfw" }), true);
});
