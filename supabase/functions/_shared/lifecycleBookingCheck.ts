// ============================================================================
// Source-lifecycle-scoped booking check shared by:
//   * runFollowUpCompletionSweep     (12-month completion → nurture)
//   * campaign-transition-replay     (historical backfill into nurture)
//
// The prior implementation blocked on ANY non-cancelled booking for the
// customer, lifetime-wide. BluLadder has repeat customers, so a completed
// historical job predating the current quote would permanently disqualify the
// customer from the unbooked-quote lifecycle. That is incorrect.
//
// The correct semantics: a booking blocks only when it represents a
// conversion of THE SOURCE QUOTE / LIFECYCLE — i.e. it is either directly
// linked to the source quote, or it is an authoritative Jobber-backed booking
// created at/after the lifecycle anchor (enrollment start for the sweep;
// source enrollment's created_at (or completion processed_at fallback) for
// the replay).
//
// Historical bookings that predate the anchor and unlinked local pending
// rows without any Jobber confirmation do NOT block.
// ============================================================================

export interface LifecycleBookingRow {
  status: string | null;
  quote_id: string | null;
  created_at: string | null;
  jobber_visit_id: string | null;
  jobber_job_id: string | null;
}

export interface LifecycleBookingScope {
  /** Source quote id from the completion event / source enrollment. */
  quoteId: string | null;
  /** Lifecycle anchor. Bookings created strictly before this do not block. */
  anchorIso: string | null;
}

// Statuses that count as authoritative on their own (no Jobber id required).
// `pending` alone does NOT — that is an incomplete local booking without
// authoritative confirmation.
const AUTHORITATIVE_STATUSES = new Set([
  "confirmed",
  "scheduled",
  "in_progress",
  "completed",
  "pending_confirmation",
  "needs_attention",
]);

/**
 * Pure decision. Exported for offline unit tests so every requirement in the
 * spec is provable without touching the DB.
 */
export function isLifecycleBlockingBooking(
  row: LifecycleBookingRow,
  scope: LifecycleBookingScope,
): boolean {
  // Cancelled bookings never block.
  if ((row.status ?? "") === "cancelled") return false;

  const isAuthoritative =
    !!row.jobber_visit_id ||
    !!row.jobber_job_id ||
    AUTHORITATIVE_STATUSES.has(row.status ?? "");

  // (1) A booking linked directly to the source quote always blocks (only if
  //     it is authoritative — a stray local pending row referencing the quote
  //     but without any Jobber confirmation is not a real conversion).
  if (scope.quoteId && row.quote_id === scope.quoteId && isAuthoritative) {
    return true;
  }

  // (2) An authoritative booking created at/after the lifecycle anchor blocks.
  //     Bookings created before the anchor are historical and never block.
  if (scope.anchorIso && row.created_at && isAuthoritative) {
    const rowMs = Date.parse(row.created_at);
    const anchorMs = Date.parse(scope.anchorIso);
    if (Number.isFinite(rowMs) && Number.isFinite(anchorMs) && rowMs >= anchorMs) {
      return true;
    }
  }

  return false;
}

/**
 * DB query: fetches candidate bookings and applies the pure gate.
 * Only reads columns needed for the decision so the query stays cheap.
 */
export async function hasLifecycleBlockingBooking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  input: { customerId: string | null } & LifecycleBookingScope,
): Promise<boolean> {
  if (!input.customerId) return false;
  const { data } = await supabase
    .from("bookings")
    .select("status, quote_id, created_at, jobber_visit_id, jobber_job_id")
    .eq("customer_id", input.customerId)
    .neq("status", "cancelled");
  const rows = (data ?? []) as LifecycleBookingRow[];
  for (const r of rows) {
    if (isLifecycleBlockingBooking(r, { quoteId: input.quoteId, anchorIso: input.anchorIso })) {
      return true;
    }
  }
  return false;
}