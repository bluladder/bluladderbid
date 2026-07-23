// ============================================================================
// executeSmsBooking — Phase 6A booking execution triggered by an explicit
// customer YES to a held slot.
//
// PIPELINE
//   1. Load presentation. It MUST be status='active', hold_status='held',
//      hold_expires_at in the future, and the hold_group_id present.
//   2. Upsert (idempotency_key = "presentation:<id>") into
//      sms_booking_confirmations with status='pending'. A duplicate YES
//      short-circuits to `duplicate_confirmation`.
//   3. Re-run getBookingReadiness — any drift = fail, no booking.
//   4. Assemble a BookingRequest strictly from server-side authoritative
//      sources (resolved customer, property, quote session lastQuoteResult,
//      held slot).
//   5. Release the presentation's temporary hold so the executor's
//      per-presentation idempotency key can re-reserve authoritatively.
//   6. Invoke the booking creator (dep-injected; wraps jobber-create-booking).
//   7. On ok: mark presentation hold_status='consumed', status='consumed',
//      update ledger to 'confirmed' with jobber ids + reference + result.
//      On fail: mark ledger 'failed' with error_code. Never emit a
//      confirmation body from a failed booking.
//
// This module owns booking side-effects; it never sends customer-facing SMS.
// The caller (handleConfirmationReply) formats and sends the confirmation.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBookingReadiness } from "./bookingReadiness.ts";
import { markHoldReleased } from "./presentation.ts";
import { releaseHold } from "./slotHold.ts";

type SB = any;

export type ExecuteFailureCode =
  | "presentation_missing"
  | "presentation_not_active"
  | "hold_missing_or_expired"
  | "readiness_not_ready"
  | "drift_detected"
  | "quote_result_missing"
  | "customer_missing"
  | "property_missing"
  | "booking_creator_rejected"
  | "booking_creator_error"
  | "ledger_write_failed"
  | "duplicate_confirmation"
  | "already_failed";

export interface ExecuteBookingResult {
  ok: boolean;
  status: "confirmed" | "duplicate_confirmation" | "failed";
  error_code?: ExecuteFailureCode | null;
  detail?: string | null;
  ledger_id?: string | null;
  booking_id?: string | null;
  reference_number?: string | null;
  jobber_job_id?: string | null;
  jobber_visit_id?: string | null;
  /** For the caller to format the SMS confirmation. */
  presentation_id: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  timezone?: string | null;
  total?: number | null;
  services?: Array<{ name: string; price: number }>;
}

export interface BookingCreatorInput {
  idempotencyKey: string;
  sessionId: string;
  customer: { email: string; firstName: string; lastName: string; phone?: string; address?: string };
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  services: Array<{ name: string; price: number }>;
  subtotal: number;
  discountAmount?: number;
  total: number;
  technicianId: string;
  teamTechnicianIds?: string[];
  isTeamJob?: boolean;
  homeDetails: Record<string, unknown>;
  additionalServices?: Record<string, unknown>;
  promotion?: { id: string; windowCount: number } | null;
  notes?: string;
}

export interface BookingCreatorSuccess {
  ok: true;
  bookingId: string;
  referenceNumber?: string | null;
  jobberJobId?: string | null;
  jobberVisitId?: string | null;
  raw?: unknown;
}

export interface BookingCreatorFailure {
  ok: false;
  code: "rejected" | "error";
  detail: string;
  raw?: unknown;
}

export type BookingCreator = (
  input: BookingCreatorInput,
) => Promise<BookingCreatorSuccess | BookingCreatorFailure>;

export interface ExecuteSmsBookingDeps {
  bookingCreator: BookingCreator;
  now?: () => Date;
  /** Test/injection seam. In production, resolves via getBookingReadiness. */
  readinessFetcher?: (
    supabase: any,
    conversationId: string,
  ) => Promise<{ status: string; blockers?: Array<{ code: string }>; quote?: any }>;
}

export interface ExecuteSmsBookingInput {
  presentationId: string;
  inboundSmsId?: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseName(full: string | null | undefined): { first: string; last: string } {
  const s = String(full ?? "").trim();
  if (!s) return { first: "Customer", last: "" };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function servicesFromLastQuote(last: any): Array<{ name: string; price: number }> {
  const items = Array.isArray(last?.jobberLineItems) && last.jobberLineItems.length > 0
    ? last.jobberLineItems
    : Array.isArray(last?.lineItems)
    ? last.lineItems
    : [];
  return items
    .map((li: any) => ({
      name: String(li.name ?? li.label ?? "Service"),
      price: Number(li.unitPrice ?? li.amount ?? 0),
    }))
    .filter((s: { price: number }) => Number.isFinite(s.price) && s.price >= 0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function executeSmsBooking(
  supabase: SB,
  input: ExecuteSmsBookingInput,
  deps: ExecuteSmsBookingDeps,
): Promise<ExecuteBookingResult> {
  const now = deps.now ? deps.now() : new Date();

  // 1) Load presentation.
  const { data: pres } = await supabase
    .from("sms_availability_presentations")
    .select("*")
    .eq("id", input.presentationId)
    .maybeSingle();

  if (!pres) {
    return {
      ok: false,
      status: "failed",
      error_code: "presentation_missing",
      presentation_id: input.presentationId,
    };
  }

  if (pres.status !== "active") {
    return {
      ok: false,
      status: "failed",
      error_code: "presentation_not_active",
      detail: `status=${pres.status}`,
      presentation_id: pres.id,
    };
  }

  if (
    pres.hold_status !== "held" ||
    !pres.hold_group_id ||
    !pres.hold_expires_at ||
    new Date(pres.hold_expires_at).getTime() <= now.getTime()
  ) {
    return {
      ok: false,
      status: "failed",
      error_code: "hold_missing_or_expired",
      detail: `hold_status=${pres.hold_status} expires=${pres.hold_expires_at ?? "null"}`,
      presentation_id: pres.id,
    };
  }

  const ledgerIdempotency = `presentation:${pres.id}`;

  // 2) Ledger upsert (idempotency_key unique). We race duplicate YES replies
  //    by inserting first. On conflict we read the existing row and short
  //    circuit.
  const insertRow = {
    conversation_id: pres.conversation_id,
    presentation_id: pres.id,
    quote_session_id: pres.quote_session_id ?? null,
    slot_group_id: pres.hold_group_id,
    idempotency_key: ledgerIdempotency,
    scheduled_start: pres.held_start_at ?? pres.selected_start_at,
    scheduled_end: pres.held_end_at ?? pres.selected_end_at,
    status: "pending",
    resolved_customer_id: pres.resolved_customer_id ?? null,
  } as Record<string, unknown>;

  const { data: inserted, error: insertErr } = await supabase
    .from("sms_booking_confirmations")
    .insert(insertRow)
    .select("*")
    .maybeSingle();

  let ledgerId: string;
  if (insertErr) {
    const isConflict = String((insertErr as any).code ?? "") === "23505"
      || /duplicate key/i.test(String((insertErr as any).message ?? ""));
    if (!isConflict) {
      return {
        ok: false,
        status: "failed",
        error_code: "ledger_write_failed",
        detail: (insertErr as any).message ?? "insert failed",
        presentation_id: pres.id,
      };
    }
    const { data: existing } = await supabase
      .from("sms_booking_confirmations")
      .select("*")
      .eq("idempotency_key", ledgerIdempotency)
      .maybeSingle();
    if (existing?.status === "confirmed") {
      return {
        ok: true,
        status: "duplicate_confirmation",
        error_code: "duplicate_confirmation",
        ledger_id: existing.id,
        booking_id: existing.booking_id ?? null,
        reference_number: existing.reference_number ?? null,
        jobber_job_id: existing.jobber_job_id ?? null,
        jobber_visit_id: existing.jobber_visit_id ?? null,
        presentation_id: pres.id,
        scheduled_start: existing.scheduled_start ?? null,
        scheduled_end: existing.scheduled_end ?? null,
      };
    }
    if (existing?.status === "failed") {
      return {
        ok: false,
        status: "failed",
        error_code: "already_failed",
        detail: existing.error_code ?? null,
        ledger_id: existing.id,
        presentation_id: pres.id,
      };
    }
    // Otherwise (pending) — proceed with existing ledger row.
    ledgerId = existing?.id ?? "";
  } else {
    ledgerId = inserted!.id;
  }

  const finishFailure = async (
    code: ExecuteFailureCode,
    detail?: string | null,
  ): Promise<ExecuteBookingResult> => {
    if (ledgerId) {
      await supabase
        .from("sms_booking_confirmations")
        .update({
          status: "failed",
          error_code: code,
          failure_reason: detail ?? null,
        })
        .eq("id", ledgerId);
    }
    return {
      ok: false,
      status: "failed",
      error_code: code,
      detail: detail ?? null,
      ledger_id: ledgerId || null,
      presentation_id: pres.id,
    };
  };

  // 3) Fresh readiness / drift check.
  const readiness = deps.readinessFetcher
    ? await deps.readinessFetcher(supabase, pres.conversation_id)
    : (await getBookingReadiness(supabase, pres.conversation_id)) as any;
  if (readiness.status !== "ready") {
    return finishFailure("readiness_not_ready", readiness.blockers?.[0]?.code ?? null);
  }

  const currentInputsKey = (readiness as any).quote?.inputs_key ?? null;
  if (
    pres.inputs_key &&
    currentInputsKey &&
    pres.inputs_key !== currentInputsKey
  ) {
    return finishFailure("drift_detected", "inputs_key_changed");
  }

  // 4) Build BookingRequest from authoritative sources.
  // Load quote session, customer, property in parallel.
  const [sessionResp, customerResp, propertyResp] = await Promise.all([
    pres.quote_session_id
      ? supabase.from("quote_sessions").select("*").eq("id", pres.quote_session_id).maybeSingle()
      : Promise.resolve({ data: null }),
    pres.resolved_customer_id
      ? supabase
          .from("customers")
          .select("id, first_name, last_name, name, email, phone")
          .eq("id", pres.resolved_customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    pres.property_id
      ? supabase
          .from("properties")
          .select("street, city, state, postal_code, formatted_address")
          .eq("id", pres.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const session: any = (sessionResp as any).data ?? null;
  const customer: any = (customerResp as any).data ?? null;
  const property: any = (propertyResp as any).data ?? null;

  const last = (session?.fields as any)?.lastQuoteResult;
  if (!last || !Number.isFinite(Number(last.total)) || Number(last.total) <= 0) {
    return finishFailure("quote_result_missing");
  }

  if (!customer) return finishFailure("customer_missing");
  const email = String(customer.email ?? "").trim();
  if (!email) return finishFailure("customer_missing", "missing_email");
  const fullName = customer.first_name || customer.last_name
    ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
    : (customer.name ?? "");
  const nameParts = parseName(fullName);

  const composed = [property?.street, property?.city, property?.state, property?.postal_code]
    .filter(Boolean).join(", ");
  const address = (property?.formatted_address ?? composed) || null;
  if (!address) return finishFailure("property_missing");

  const services = servicesFromLastQuote(last);
  if (services.length === 0) return finishFailure("quote_result_missing", "no_line_items");

  const heldCrew: string[] = Array.isArray(pres.held_crew_ids) ? pres.held_crew_ids : [];
  if (heldCrew.length === 0) {
    return finishFailure("hold_missing_or_expired", "no_crew_on_hold");
  }
  const technicianId = heldCrew[0];
  const teamTechnicianIds = heldCrew.length > 1 ? heldCrew : undefined;

  const scheduledStart = String(pres.held_start_at ?? pres.selected_start_at);
  const scheduledEnd = String(pres.held_end_at ?? pres.selected_end_at);
  const durationMinutes = Math.max(
    1,
    Math.round((new Date(scheduledEnd).getTime() - new Date(scheduledStart).getTime()) / 60000),
  );

  const subtotal = Number(last.subtotal ?? last.total ?? 0);
  const total = Number(last.total ?? 0);
  const discountAmount = Number(last.discountAmount ?? 0) || 0;

  const bookingInput: BookingCreatorInput = {
    idempotencyKey: ledgerIdempotency,
    sessionId: pres.id,
    customer: { email, firstName: nameParts.first, lastName: nameParts.last, phone: customer.phone ?? undefined, address },
    scheduledStart,
    scheduledEnd,
    durationMinutes,
    services,
    subtotal,
    discountAmount,
    total,
    technicianId,
    teamTechnicianIds,
    isTeamJob: !!teamTechnicianIds,
    homeDetails: (last.homeDetails as Record<string, unknown>) ?? {},
    additionalServices: (last.additionalServices as Record<string, unknown>) ?? {},
    promotion: (last.promotion as any) ?? null,
    notes: `Booked via SMS confirmation. Presentation ${pres.id}.`,
  };

  // 5) Release the temporary hold so the creator's fresh reservation can win
  //    the capacity. We record 'consumed_by_booking' on the presentation so
  //    the audit trail is unambiguous.
  try {
    await releaseHold(
      supabase,
      pres.id,
      pres.hold_group_id,
      "consumed_by_booking",
    );
  } catch (_e) {
    // Non-fatal: if the RPC transient-fails the creator will still enforce
    // capacity via its own reservation. Continue.
  }

  // 6) Call the booking creator.
  let creator: BookingCreatorSuccess | BookingCreatorFailure;
  try {
    creator = await deps.bookingCreator(bookingInput);
  } catch (e) {
    // Attempt to re-acquire the hold we just released — best effort, ignored
    // if it fails; reconciliation is Phase 6B.
    return finishFailure("booking_creator_error", e instanceof Error ? e.message : String(e));
  }

  if (!creator.ok) {
    return finishFailure(
      creator.code === "rejected" ? "booking_creator_rejected" : "booking_creator_error",
      creator.detail,
    );
  }

  // 7) Mark hold consumed + presentation consumed + ledger confirmed.
  await supabase
    .from("sms_availability_presentations")
    .update({
      status: "consumed",
      hold_status: "consumed",
      hold_released_at: now.toISOString(),
      hold_release_reason: "consumed_by_booking",
    })
    .eq("id", pres.id);

  const updateLedger = {
    status: "confirmed" as const,
    booking_id: creator.bookingId,
    jobber_job_id: creator.jobberJobId ?? null,
    jobber_visit_id: creator.jobberVisitId ?? null,
    reference_number: creator.referenceNumber ?? null,
    booked_at: now.toISOString(),
    confirmed_at: now.toISOString(),
    inbound_sms_id: input.inboundSmsId ?? null,
    error_code: null,
    booking_result: (creator.raw as any) ?? null,
  };
  if (ledgerId) {
    await supabase.from("sms_booking_confirmations").update(updateLedger).eq("id", ledgerId);
  }

  return {
    ok: true,
    status: "confirmed",
    ledger_id: ledgerId || null,
    booking_id: creator.bookingId,
    reference_number: creator.referenceNumber ?? null,
    jobber_job_id: creator.jobberJobId ?? null,
    jobber_visit_id: creator.jobberVisitId ?? null,
    presentation_id: pres.id,
    scheduled_start: scheduledStart,
    scheduled_end: scheduledEnd,
    timezone: (pres.options?.[0] as any)?.timezone ?? null,
    total,
    services,
  };
}

// ---------------------------------------------------------------------------
// Default BookingCreator implementation: POSTs to jobber-create-booking.
// Injected in production; tests supply their own creator.
// ---------------------------------------------------------------------------

export function makeHttpBookingCreator(): BookingCreator {
  return async (input) => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return { ok: false, code: "error", detail: "missing_supabase_env" };
    }
    const endpoint = `${url}/functions/v1/jobber-create-booking`;
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
          "apikey": key,
        },
        body: JSON.stringify(input),
      });
      const bodyText = await resp.text();
      let json: any = null;
      try { json = JSON.parse(bodyText); } catch { /* not json */ }
      if (!resp.ok) {
        return { ok: false, code: "rejected", detail: `HTTP ${resp.status}: ${bodyText.slice(0, 300)}`, raw: json };
      }
      if (!json || json.success === false || !json.bookingId) {
        return { ok: false, code: "rejected", detail: json?.error ?? "no_booking_id", raw: json };
      }
      return {
        ok: true,
        bookingId: String(json.bookingId),
        referenceNumber: json.referenceNumber ?? json.reference_number ?? null,
        jobberJobId: json.jobberJobId ?? json.jobber_job_id ?? null,
        jobberVisitId: json.jobberVisitId ?? json.jobber_visit_id ?? null,
        raw: json,
      };
    } catch (e) {
      return { ok: false, code: "error", detail: e instanceof Error ? e.message : String(e) };
    }
  };
}