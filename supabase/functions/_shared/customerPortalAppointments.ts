// Pure customer-portal appointment projection.
//
// BluLadder bookings retain the schedule accepted when the booking was
// created. Jobber remains the authoritative operational calendar after that
// point, and its webhook/sync workers mirror visit changes into
// jobber_busy_blocks. Project the freshest active mirror values at read time so
// a Jobber reschedule is reflected in the portal without mutating booking
// history or trusting browser-supplied identity.

export interface CustomerPortalBookingRow {
  jobber_visit_id?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  home_details_json?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface JobberVisitBlockSnapshot {
  jobber_visit_id: string | null;
  client_address: string | null;
  start_at: string | null;
  end_at: string | null;
  status: string | null;
  updated_at: string | null;
}

export interface ProjectedCustomerPortalBooking
  extends CustomerPortalBookingRow {
  address: string | null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function extractAddress(
  homeDetails: Record<string, unknown> | null | undefined,
): string | null {
  if (!homeDetails || typeof homeDetails !== "object") return null;
  for (
    const key of ["address", "propertyAddress", "fullAddress", "serviceAddress"]
  ) {
    const value = nonEmptyString(homeDetails[key]);
    if (value) return value;
  }
  return null;
}

/** Select one freshest non-cancelled Jobber mirror row per visit. */
export function selectFreshestJobberVisitBlocks(
  blocks: JobberVisitBlockSnapshot[],
): Map<string, JobberVisitBlockSnapshot> {
  const selected = new Map<string, JobberVisitBlockSnapshot>();
  for (const block of blocks) {
    const visitId = nonEmptyString(block.jobber_visit_id);
    if (!visitId || block.status === "cancelled") continue;
    const current = selected.get(visitId);
    if (
      !current || timestamp(block.updated_at) > timestamp(current.updated_at)
    ) {
      selected.set(visitId, block);
    }
  }
  return selected;
}

/**
 * Overlay only trusted Jobber-mirror schedule/address values. Every other
 * booking field remains unchanged and server-authoritative.
 */
export function projectCustomerPortalBookings(
  bookings: CustomerPortalBookingRow[],
  blocks: JobberVisitBlockSnapshot[],
  fallbackAddress: string | null,
  direction: "asc" | "desc" = "asc",
): ProjectedCustomerPortalBooking[] {
  const blocksByVisit = selectFreshestJobberVisitBlocks(blocks);
  const projected = bookings.map((booking) => {
    const visitId = nonEmptyString(booking.jobber_visit_id);
    const block = visitId ? blocksByVisit.get(visitId) : undefined;
    return {
      ...booking,
      scheduled_start: nonEmptyString(block?.start_at) ??
        booking.scheduled_start ?? null,
      scheduled_end: nonEmptyString(block?.end_at) ??
        booking.scheduled_end ?? null,
      address: nonEmptyString(block?.client_address) ??
        extractAddress(booking.home_details_json) ?? fallbackAddress,
    };
  });

  return projected.sort((a, b) => {
    const aTime = timestamp(a.scheduled_start);
    const bTime = timestamp(b.scheduled_start);
    if (aTime === bTime) return 0;
    return direction === "asc" ? aTime - bTime : bTime - aTime;
  });
}
