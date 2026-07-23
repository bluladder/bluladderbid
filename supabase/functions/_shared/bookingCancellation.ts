// ============================================================================
// bookingCancellation — canonical helper used by every authoritative
// cancellation path (customer portal, admin, Jobber webhook, reconciliation,
// handle-confirmation). Guarantees exactly-once lifecycle treatment:
//
//   * loads the current booking under an optimistic version lock,
//   * treats a booking already cancelled at >= incoming version as an
//     idempotent no-op (no version bump, no duplicate emit),
//   * bumps booking_version + cancellation_lifecycle_version atomically,
//   * releases slot reservations + mirrors busy blocks,
//   * emits the canonical `booking_cancelled` campaign event, unless the
//     caller explicitly persisted `suppress_customer_confirmation`.
//
// This file is deliberately pure at its core (`decideCancellationOutcome`) so
// the reconciliation branches can be unit-tested without a live client.
// ============================================================================
import { emitCampaignEvent, type SupabaseLike } from "./campaignEmitter.ts";
import { getAppUrl } from "./appUrl.ts";

// Sources allowed on the authoritative booking row. Never widen without also
// widening the audit narrative on cancellation_source.
export type CancellationSource =
  | "customer_portal"
  | "admin"
  | "jobber_webhook"
  | "reconciliation"
  | "customer_confirmation"; // handle-confirmation accept path

export interface CancellationInput {
  bookingId: string;
  source: CancellationSource;
  actorId?: string | null;
  reason?: string | null;
  notes?: string | null;
  jobberOutcome?: "confirmed" | "already_gone" | "reconciled";
  suppressCustomerConfirmation?: boolean; // explicit override only
}

export type CancellationDecision =
  | { kind: "apply"; currentVersion: number; nextVersion: number }
  | { kind: "already_cancelled_same_or_newer"; currentVersion: number; existingVersion: number }
  | { kind: "not_found" }
  | { kind: "terminal_completed"; currentVersion: number };

// Pure function: given the booking snapshot, decide what to do.
// Idempotent-by-design: a webhook replay for a booking already cancelled at
// the same or newer lifecycle version is a no-op.
export function decideCancellationOutcome(
  booking:
    | {
        id: string;
        status: string | null;
        booking_version: number | null;
        cancellation_lifecycle_version: number | null;
      }
    | null,
): CancellationDecision {
  if (!booking) return { kind: "not_found" };
  const currentVersion = Number(booking.booking_version ?? 1);
  const cancelledVersion = Number(booking.cancellation_lifecycle_version ?? 0);
  if (booking.status === "completed") return { kind: "terminal_completed", currentVersion };
  if (booking.status === "cancelled") {
    return {
      kind: "already_cancelled_same_or_newer",
      currentVersion,
      existingVersion: cancelledVersion || currentVersion,
    };
  }
  return { kind: "apply", currentVersion, nextVersion: currentVersion + 1 };
}

export interface CancellationResult {
  applied: boolean;
  idempotent: boolean;
  version: number;
  status: "cancelled" | "already_cancelled" | "not_found" | "terminal_completed" | "raced" | "needs_attention";
  reason?: string;
}

// Trim structured fields to safe lengths.
function trim(s: string | null | undefined, max: number): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, max) : null;
}

// Finalize a cancellation authoritatively. Callers MUST have already
// confirmed removal in Jobber where applicable and pass `jobberOutcome`.
// deno-lint-ignore no-explicit-any
export async function finalizeBookingCancellation(
  supabase: any & SupabaseLike,
  input: CancellationInput,
): Promise<CancellationResult> {
  const { bookingId } = input;
  const { data: booking, error: loadErr } = await supabase
    .from("bookings")
    .select(
      "id, reference_number, status, booking_version, cancellation_lifecycle_version, jobber_visit_id, scheduled_start, services_json, home_details_json, quote_id, total, customer_id, customer:customers(email)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (loadErr) return { applied: false, idempotent: false, version: 0, status: "needs_attention", reason: loadErr.message };

  const decision = decideCancellationOutcome(booking);
  if (decision.kind === "not_found") return { applied: false, idempotent: true, version: 0, status: "not_found" };
  if (decision.kind === "terminal_completed") {
    return { applied: false, idempotent: true, version: decision.currentVersion, status: "terminal_completed", reason: "Booking already completed" };
  }
  if (decision.kind === "already_cancelled_same_or_newer") {
    return { applied: false, idempotent: true, version: decision.existingVersion, status: "already_cancelled" };
  }

  const { currentVersion, nextVersion } = decision;
  const nowIso = new Date().toISOString();
  const actorUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.actorId ?? "")
    ? (input.actorId as string)
    : null;

  const { data: updated, error: updErr } = await supabase
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancellation_source: input.source,
      cancellation_reason: trim(input.reason ?? null, 120),
      cancellation_notes: trim(input.notes ?? null, 500),
      cancelled_by: actorUuid,
      cancellation_lifecycle_version: nextVersion,
      jobber_cancellation_status: input.jobberOutcome ?? "reconciled",
      slot_released_at: nowIso,
      booking_version: nextVersion,
      cancellation_needs_attention_reason: null,
      updated_at: nowIso,
    })
    .eq("id", bookingId)
    .eq("booking_version", currentVersion)
    .select("id, booking_version")
    .maybeSingle();

  if (updErr) return { applied: false, idempotent: false, version: currentVersion, status: "needs_attention", reason: updErr.message };
  if (!updated) return { applied: false, idempotent: false, version: currentVersion, status: "raced", reason: "Concurrent write" };

  // Release busy blocks + slot reservations (soft, non-fatal).
  if (booking.jobber_visit_id) {
    await supabase
      .from("jobber_busy_blocks")
      .update({ status: "cancelled", updated_at: nowIso })
      .eq("jobber_visit_id", booking.jobber_visit_id);
  }
  await supabase
    .from("slot_reservations")
    .update({ status: "released", updated_at: nowIso })
    .eq("booking_id", bookingId)
    .in("status", ["held", "confirmed"]);

  // Emit canonical event unless explicitly suppressed.
  if (!input.suppressCustomerConfirmation) {
    const APP_URL = getAppUrl();
    const serviceNames = Array.isArray(booking.services_json)
      ? (booking.services_json as Array<{ name?: string }>).map((s) => s?.name).filter(Boolean) as string[]
      : [];
    const serviceAddress = (booking.home_details_json as Record<string, unknown> | null)?.address ?? "";
    await emitCampaignEvent({
      eventName: "booking_cancelled",
      idempotencyKey: `booking_cancelled:${bookingId}:v${nextVersion}`,
      email: booking.customer?.email ?? null,
      customerId: booking.customer_id,
      source: `booking-cancellation:${input.source}`,
      subject: "Appointment cancelled",
      recoverySupabase: supabase as SupabaseLike,
      metadata: {
        booking_id: bookingId,
        booking_version: nextVersion,
        quote_id: booking.quote_id ?? null,
        jobber_visit_id: booking.jobber_visit_id ?? null,
        booking_status: "cancelled",
        cancellation_source: input.source,
        previous_appointment_date: booking.scheduled_start,
        previous_arrival_window: null,
        service: serviceNames[0] ?? "your service",
        service_names: serviceNames,
        service_types: serviceNames,
        service_address: serviceAddress,
        booking_total: booking.total,
        cancellation_reason: trim(input.reason ?? null, 120),
        manage_link: `${APP_URL}/customer-portal`,
        booking_link: `${APP_URL}/`,
      },
    });
  }

  return { applied: true, idempotent: false, version: nextVersion, status: "cancelled" };
}
