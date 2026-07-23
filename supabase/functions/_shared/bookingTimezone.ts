// ============================================================================
// bookingTimezone — Phase 6B.3 timezone resolution.
//
// Resolution order for a booking-confirmation SMS timezone:
//   1. presentation option (`held_option.timezone` / first option) —
//      already stamped by the availability engine when a slot is offered.
//   2. property (`properties.timezone`) — currently not populated but honored
//      if present so a future property-level TZ column starts working
//      immediately.
//   3. business fallback — America/Chicago (BluLadder ops).
//
// The chosen zone is persisted on `sms_booking_confirmations.booking_timezone`
// at commit time so historical rows never re-shift under configuration
// changes.
// ============================================================================

export const BLULADDER_DEFAULT_TIMEZONE = "America/Chicago";

// deno-lint-ignore no-explicit-any
export function resolveBookingTimezone(input: {
  presentation?: any;
  property?: any;
}): string {
  const pres = input.presentation;
  const heldOpt = pres?.held_option;
  const firstOpt = Array.isArray(pres?.options) ? pres.options[0] : null;
  const presTz = pickString(
    heldOpt?.timezone,
    heldOpt?.tz,
    firstOpt?.timezone,
    firstOpt?.tz,
  );
  if (presTz) return presTz;

  const prop = input.property;
  const propTz = pickString(prop?.timezone, prop?.tz);
  if (propTz) return propTz;

  return BLULADDER_DEFAULT_TIMEZONE;
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

/**
 * Format a booking start Date/ISO using the resolved timezone. Renders
 * correctly across DST because Intl.DateTimeFormat honors the IANA rules.
 */
export function formatBookingWhen(
  scheduledStart: string | Date | null | undefined,
  timezone: string,
): string {
  if (!scheduledStart) return "your requested time";
  const start = scheduledStart instanceof Date ? scheduledStart : new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) return "your requested time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(start);
}