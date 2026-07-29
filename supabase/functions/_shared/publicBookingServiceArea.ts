import type { ServiceAddress } from "./publicBookingCustomer.ts";
import type { ServiceAreaResult } from "./serviceArea.ts";

export const PUBLIC_BOOKING_ORGANIZATION_ID =
  "b1addf00-0000-4000-8000-000000000001";

export type PublicBookingEligibility =
  | {
    status: "eligible";
    organizationId: typeof PUBLIC_BOOKING_ORGANIZATION_ID;
    normalizedAddress: {
      city: string;
      state: string;
      postalCode: string;
      countryCode: "US";
    };
  }
  | {
    status:
      | "ineligible"
      | "manual_review"
      | "ambiguous"
      | "provider_unavailable"
      | "configuration_unavailable";
    code:
      | "OUTSIDE_DFW_SERVICE_AREA"
      | "SERVICE_AREA_MANUAL_REVIEW"
      | "ADDRESS_AMBIGUOUS"
      | "GEOCODER_UNAVAILABLE"
      | "SERVICE_AREA_CONFIGURATION_UNAVAILABLE";
    retryable: boolean;
  };

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function zip5(value: string | null | undefined): string {
  return norm(value).slice(0, 5);
}

function normalizeRoute(value: string | null | undefined): string {
  const suffixes: Record<string, string> = {
    avenue: "ave",
    boulevard: "blvd",
    circle: "cir",
    court: "ct",
    drive: "dr",
    highway: "hwy",
    lane: "ln",
    parkway: "pkwy",
    place: "pl",
    road: "rd",
    street: "st",
    terrace: "ter",
    trail: "trl",
  };
  return norm(value)
    .replace(/[.,]/g, "")
    .split(" ")
    .map((part) => suffixes[part] ?? part)
    .join(" ");
}

function submittedStreet(street1: string): {
  streetNumber: string;
  route: string;
} | null {
  const match = street1.trim().match(/^([0-9]+[A-Za-z]?)\s+(.+)$/);
  if (!match) return null;
  const route = match[2]
    .replace(/\s+(?:#|apt\.?|apartment|suite|ste\.?|unit)\s+.*$/i, "")
    .trim();
  if (!route) return null;
  return {
    streetNumber: norm(match[1]),
    route: normalizeRoute(route),
  };
}

export function hasAttemptedOrganizationOverride(
  payload: Record<string, unknown>,
): boolean {
  return ["organizationId", "organization_id", "organization"].some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
}

export function evaluatePublicBookingServiceArea(
  submitted: ServiceAddress,
  resolved: ServiceAreaResult,
): PublicBookingEligibility {
  if (resolved.status === "validation_unavailable") {
    if (resolved.reason === "service_area_configuration_unavailable") {
      return {
        status: "configuration_unavailable",
        code: "SERVICE_AREA_CONFIGURATION_UNAVAILABLE",
        retryable: true,
      };
    }
    return {
      status: "provider_unavailable",
      code: "GEOCODER_UNAVAILABLE",
      retryable: true,
    };
  }

  if (resolved.status === "address_incomplete") {
    return {
      status: "ambiguous",
      code: "ADDRESS_AMBIGUOUS",
      retryable: true,
    };
  }

  if (resolved.status === "manual_review_required") {
    if (resolved.reasonCode === "configured_manual_review_county") {
      return {
        status: "manual_review",
        code: "SERVICE_AREA_MANUAL_REVIEW",
        retryable: false,
      };
    }
    return {
      status: "ineligible",
      code: "OUTSIDE_DFW_SERVICE_AREA",
      retryable: false,
    };
  }

  const providerCity = norm(resolved.city);
  const providerState = norm(resolved.state);
  const providerPostalCode = zip5(resolved.postalCode);
  const providerCountryCode = norm(resolved.countryCode);
  const submittedStreetParts = submittedStreet(submitted.street1);
  const conflicts = providerCity !== norm(submitted.city) ||
    providerState !== norm(submitted.province) ||
    providerPostalCode !== zip5(submitted.postalCode) ||
    providerCountryCode !== "us" ||
    !submittedStreetParts ||
    norm(resolved.streetNumber) !== submittedStreetParts.streetNumber ||
    normalizeRoute(resolved.route) !== submittedStreetParts.route;

  if (
    conflicts ||
    !providerCity ||
    !providerState ||
    !providerPostalCode ||
    !providerCountryCode ||
    !resolved.streetNumber ||
    !resolved.route
  ) {
    return {
      status: "ambiguous",
      code: "ADDRESS_AMBIGUOUS",
      retryable: true,
    };
  }

  return {
    status: "eligible",
    organizationId: PUBLIC_BOOKING_ORGANIZATION_ID,
    normalizedAddress: {
      city: resolved.city!.trim().replace(/\s+/g, " "),
      state: resolved.state!.trim().toUpperCase(),
      postalCode: resolved.postalCode!.trim(),
      countryCode: "US",
    },
  };
}
