// ============================================================================
// executeSmsBooking — Phase 6A booking execution triggered by an explicit
// customer YES to a held slot.
//
// PHASE 6A SAFETY-CORRECTED SEQUENCE
//
//   validate confirmation
//   → atomically CLAIM booking execution (claim_sms_booking_execution)
//   → verify the reservation is still live
//   → KEEP the temporary hold active
//   → invoke the idempotent booking creator (passing the SAME idempotency
//       key that already reserved the hold — jobber-create-booking's
//       reserve_booking_slot RPC is idempotent on that key, so this call
//       will not race with our own held reservation)
//   → on verified SUCCESS: atomically persist Jobber + local ids and
//       transition the presentation hold from 'held' → 'consumed' in ONE
//       RPC (commit_sms_booking_success)
//   → on verified TERMINAL rejection: mark_sms_booking_terminal_failure
//       (this — and only this — releases the hold on the failure path)
//   → on UNKNOWN outcome (timeout / connection reset / malformed response
//       / local commit crash): mark_sms_booking_recoverable_failure
//       (PRESERVES the hold so reconciliation can resolve the truth)
//
// The hold is released ONLY when: the customer explicitly declines (caller
// concern), validation fails in a manner requiring release, the booking
// creator returns a verified terminal rejection, the hold expires, or a
// deliberate compensation path releases it. A timeout / unknown outcome
// NEVER releases capacity, because the external booking may have succeeded.
//
// This module owns booking side-effects; it never sends customer-facing SMS.
// The caller (handleConfirmationReply) formats and sends the confirmation.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getBookingReadiness } from "./bookingReadiness.ts";

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
  | "booking_creator_unknown"
  | "reservation_not_live"
  | "commit_rpc_failed"
  | "execution_claim_denied"
  | "ledger_write_failed"
  | "duplicate_confirmation"
  | "in_progress"
  | "already_failed";

// Phase 6B.1 — every non-terminal-success outcome maps to a failure class.
// Reconciliation-only classes are refused by customer-driven claims.
export type FailureClass =
  | "pre_claim_drift"
  | "input_missing"
  | "reservation_not_live"
  | "verified_terminal_rejection"
  | "external_outcome_unknown"
  | "external_committed_pending_local"
  | "manual_review_required";

export interface ExecuteBookingResult {
  ok: boolean;
  status:
    | "confirmed"
    | "duplicate_confirmation"
    | "in_progress"
    | "failed"
    | "failed_recoverable"
    | "failed_terminal";
  error_code?: ExecuteFailureCode | null;
  detail?: string | null;
  ledger_id?: string | null;
  booking_id?: string | null;
  reference_number?: string | null;
  jobber_job_id?: string | null;
  jobber_visit_id?: string | null;
  presentation_id: string;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  timezone?: string | null;
  total?: number | null;
  services?: Array<{ name: string; price: number }>;
  /** Canonical booking idempotency key used for this attempt. */
  booking_idempotency_key?: string | null;
  /** True when the caller must NOT tell the customer the booking failed —
   *  the external outcome is unknown and the reservation is still held. */
  preserve_customer_uncertainty?: boolean;
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
  /** rejected = verified terminal rejection (safe to release the hold).
   *  unknown  = network / timeout / malformed response — KEEP the hold and
   *             enter failed_recoverable so reconciliation resolves truth. */
  code: "rejected" | "unknown";
  detail: string;
  raw?: unknown;
}

export type BookingCreator = (
  input: BookingCreatorInput,
) => Promise<BookingCreatorSuccess | BookingCreatorFailure>;

export interface ExecuteSmsBookingDeps {
  bookingCreator: BookingCreator;
  now?: () => Date;
  readinessFetcher?: (
    supabase: any,
    conversationId: string,
  ) => Promise<{ status: string; blockers?: Array<{ code: string }>; quote?: any; customer?: any }>;
  tokenFactory?: () => string;
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

/** Canonical booking idempotency key derived from immutable authoritative
 *  context. This is the SAME key that reserved the current hold, so the
 *  downstream jobber-create-booking `reserve_booking_slot` RPC returns an
 *  idempotent match to our existing held reservation rather than racing it. */
export function deriveBookingIdempotencyKey(pres: any): string {
  if (pres.hold_idempotency_key) return String(pres.hold_idempotency_key);
  const parts = [
    "sms",
    pres.id,
    pres.hold_group_id ?? "no-group",
    pres.conversation_id,
    pres.quote_session_id ?? "no-session",
    pres.selected_slot_id ?? "no-slot",
  ];
  return parts.join(":");
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
  const tokenFactory = deps.tokenFactory ?? (() => crypto.randomUUID());

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
  const bookingIdempotencyKey = deriveBookingIdempotencyKey(pres);

  // 2) Ledger upsert (unique idempotency_key). Losers of the insert race
  //    read the existing row; the atomic claim RPC below picks exactly one
  //    worker to invoke the booking creator.
  const insertRow: Record<string, unknown> = {
    conversation_id: pres.conversation_id,
    presentation_id: pres.id,
    quote_session_id: pres.quote_session_id ?? null,
    slot_group_id: pres.hold_group_id,
    idempotency_key: ledgerIdempotency,
    booking_idempotency_key: bookingIdempotencyKey,
    scheduled_start: pres.held_start_at ?? pres.selected_start_at,
    scheduled_end: pres.held_end_at ?? pres.selected_end_at,
    status: "pending",
    resolved_customer_id: pres.resolved_customer_id ?? null,
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("sms_booking_confirmations")
    .insert(insertRow)
    .select("*")
    .maybeSingle();

  let ledgerId = "";
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

    // Terminal or already-committed states short-circuit BEFORE the claim.
    if (
      existing?.status === "confirmed" ||
      existing?.status === "local_committed" ||
      existing?.status === "confirmation_pending"
    ) {
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
        booking_idempotency_key:
          existing.booking_idempotency_key ?? bookingIdempotencyKey,
      };
    }
    if (existing?.status === "failed_terminal") {
      return {
        ok: false,
        status: "failed_terminal",
        error_code: "already_failed",
        detail: existing.error_code ?? null,
        ledger_id: existing.id,
        presentation_id: pres.id,
      };
    }
    ledgerId = existing?.id ?? "";
  } else {
    ledgerId = inserted!.id;
  }

  // Pre-claim failure path: preserve hold, mark failed_recoverable.
  const finishPreClaimFailure = async (
    code: ExecuteFailureCode,
    detail?: string | null,
    failureClass: FailureClass = "pre_claim_drift",
  ): Promise<ExecuteBookingResult> => {
    if (ledgerId) {
      await supabase
        .from("sms_booking_confirmations")
        .update({
          status: "failed_recoverable",
          failure_class: failureClass,
          error_code: code,
          last_error: detail ?? null,
          last_error_at: new Date().toISOString(),
        })
        .eq("id", ledgerId);
    }
    return {
      ok: false,
      status: "failed_recoverable",
      error_code: code,
      detail: detail ?? null,
      ledger_id: ledgerId || null,
      presentation_id: pres.id,
      preserve_customer_uncertainty: true,
    };
  };

  const finishTerminalFailure = async (
    executionToken: string,
    code: ExecuteFailureCode,
    detail?: string | null,
    providerResponse?: any,
    failureClass: FailureClass = "verified_terminal_rejection",
  ): Promise<ExecuteBookingResult> => {
    if (ledgerId) {
      await supabase.rpc("mark_sms_booking_terminal_failure", {
        p_confirmation_id: ledgerId,
        p_execution_token: executionToken,
        p_failure_class: failureClass,
        p_error_code: code,
        p_last_error: detail ?? null,
        p_provider_response: providerResponse ?? null,
      });
    }
    return {
      ok: false,
      status: "failed_terminal",
      error_code: code,
      detail: detail ?? null,
      ledger_id: ledgerId || null,
      presentation_id: pres.id,
    };
  };

  const finishRecoverableFailure = async (
    executionToken: string,
    code: ExecuteFailureCode,
    detail?: string | null,
    providerRequest?: any,
    providerResponse?: any,
    failureClass: FailureClass = "external_outcome_unknown",
  ): Promise<ExecuteBookingResult> => {
    if (ledgerId) {
      await supabase.rpc("mark_sms_booking_recoverable_failure", {
        p_confirmation_id: ledgerId,
        p_execution_token: executionToken,
        p_failure_class: failureClass,
        p_error_code: code,
        p_last_error: detail ?? null,
        p_provider_request: providerRequest ?? null,
        p_provider_response: providerResponse ?? null,
        p_reconciliation_status: "pending",
      });
    }
    return {
      ok: false,
      status: "failed_recoverable",
      error_code: code,
      detail: detail ?? null,
      ledger_id: ledgerId || null,
      presentation_id: pres.id,
      preserve_customer_uncertainty: true,
    };
  };

  // 3) Drift check (BEFORE claim).
  const readiness = deps.readinessFetcher
    ? await deps.readinessFetcher(supabase, pres.conversation_id)
    : (await getBookingReadiness(supabase, pres.conversation_id)) as any;
  if (readiness.status !== "ready") {
    return finishPreClaimFailure(
      "readiness_not_ready",
      readiness.blockers?.[0]?.code ?? null,
      "pre_claim_drift",
    );
  }

  const currentInputsKey = (readiness as any).quote?.inputs_key ?? null;
  if (
    pres.inputs_key &&
    currentInputsKey &&
    pres.inputs_key !== currentInputsKey
  ) {
    return finishPreClaimFailure("drift_detected", "inputs_key_changed", "pre_claim_drift");
  }

  const currentResolvedCustomer =
    (readiness as any).customer?.id ??
    (readiness as any).resolved_customer_id ??
    null;
  if (
    pres.resolved_customer_id &&
    currentResolvedCustomer &&
    pres.resolved_customer_id !== currentResolvedCustomer
  ) {
    return finishPreClaimFailure("drift_detected", "customer_id_changed", "pre_claim_drift");
  }

  // Verify the reservation row underlying this hold is still LIVE.
  try {
    const { data: resv } = await supabase
      .from("slot_reservations")
      .select("group_id, status, expires_at")
      .eq("group_id", pres.hold_group_id)
      .limit(1)
      .maybeSingle();
    if (resv) {
      const status = String(resv.status ?? "").toLowerCase();
      const stillLive = status === "held" || status === "confirmed"
        || status === "active" || status === "reserved";
      const notExpired = !resv.expires_at
        || new Date(resv.expires_at).getTime() > now.getTime();
      if (!stillLive || !notExpired) {
        return finishPreClaimFailure(
          "reservation_not_live",
          `status=${status}`,
          "reservation_not_live",
        );
      }
    }
    // Missing row → let the idempotent booking creator re-verify capacity.
  } catch (_e) {
    // Read error is not fatal to pre-claim; the creator still enforces via
    // reserve_booking_slot.
  }

  // 4) ATOMIC EXECUTION CLAIM — only one worker gets to call the creator.
  const executionToken = tokenFactory();
  const { data: claim } = await supabase.rpc("claim_sms_booking_execution", {
    p_confirmation_id: ledgerId,
    p_execution_token: executionToken,
    p_claim_source: "customer",
  });
  const claimRes = (claim ?? {}) as any;
  if (claimRes.ok === false) {
    if (claimRes.reason === "already_completed") {
      return {
        ok: true,
        status: "duplicate_confirmation",
        error_code: "duplicate_confirmation",
        ledger_id: ledgerId,
        booking_id: claimRes.booking_id ?? null,
        reference_number: claimRes.reference_number ?? null,
        jobber_job_id: claimRes.jobber_job_id ?? null,
        jobber_visit_id: claimRes.jobber_visit_id ?? null,
        presentation_id: pres.id,
        booking_idempotency_key: bookingIdempotencyKey,
      };
    }
    if (claimRes.reason === "in_progress") {
      return {
        ok: false,
        status: "in_progress",
        error_code: "in_progress",
        detail: "another_worker_executing",
        ledger_id: ledgerId,
        presentation_id: pres.id,
        preserve_customer_uncertainty: true,
      };
    }
    if (claimRes.reason === "failed_terminal") {
      return {
        ok: false,
        status: "failed_terminal",
        error_code: "already_failed",
        detail: claimRes.last_error ?? null,
        ledger_id: ledgerId,
        presentation_id: pres.id,
      };
    }
    return finishPreClaimFailure("execution_claim_denied", claimRes.reason ?? "unknown");
  }

  // 5) Build BookingRequest from authoritative sources.
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
    return finishRecoverableFailure(
      executionToken,
      "quote_result_missing",
      null,
      null,
      null,
      "input_missing",
    );
  }

  if (!customer) {
    return finishRecoverableFailure(
      executionToken,
      "customer_missing",
      null,
      null,
      null,
      "input_missing",
    );
  }
  const email = String(customer.email ?? "").trim();
  if (!email) {
    return finishRecoverableFailure(
      executionToken,
      "customer_missing",
      "missing_email",
      null,
      null,
      "input_missing",
    );
  }
  const fullName = customer.first_name || customer.last_name
    ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim()
    : (customer.name ?? "");
  const nameParts = parseName(fullName);

  const composed = [property?.street, property?.city, property?.state, property?.postal_code]
    .filter(Boolean).join(", ");
  const address = (property?.formatted_address ?? composed) || null;
  if (!address) {
    return finishRecoverableFailure(
      executionToken,
      "property_missing",
      null,
      null,
      null,
      "input_missing",
    );
  }

  const services = servicesFromLastQuote(last);
  if (services.length === 0) {
    return finishRecoverableFailure(
      executionToken,
      "quote_result_missing",
      "no_line_items",
      null,
      null,
      "input_missing",
    );
  }

  const heldCrew: string[] = Array.isArray(pres.held_crew_ids) ? pres.held_crew_ids : [];
  if (heldCrew.length === 0) {
    return finishRecoverableFailure(
      executionToken,
      "hold_missing_or_expired",
      "no_crew_on_hold",
      null,
      null,
      "reservation_not_live",
    );
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
    // Same key that reserved the current hold — jobber-create-booking's
    // reserve_booking_slot returns idempotent replay on this key.
    idempotencyKey: bookingIdempotencyKey,
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

  // The hold is INTENTIONALLY LEFT ACTIVE across the external call.

  // 6) Invoke the booking creator.
  let creator: BookingCreatorSuccess | BookingCreatorFailure;
  try {
    creator = await deps.bookingCreator(bookingInput);
  } catch (e) {
    // Thrown exception → UNKNOWN external outcome. Keep the hold.
    return finishRecoverableFailure(
      executionToken,
      "booking_creator_unknown",
      e instanceof Error ? e.message : String(e),
      bookingInput as any,
      null,
      "external_outcome_unknown",
    );
  }

  if (!creator.ok) {
    if (creator.code === "rejected") {
      return finishTerminalFailure(
        executionToken,
        "booking_creator_rejected",
        creator.detail,
        (creator as any).raw ?? null,
        "verified_terminal_rejection",
      );
    }
    return finishRecoverableFailure(
      executionToken,
      "booking_creator_unknown",
      creator.detail,
      bookingInput as any,
      (creator as any).raw ?? null,
      "external_outcome_unknown",
    );
  }

  // 7) Atomic local commit + hold consumption.
  const { data: commit } = await supabase.rpc("commit_sms_booking_success", {
    p_confirmation_id: ledgerId,
    p_execution_token: executionToken,
    p_presentation_id: pres.id,
    p_hold_group_id: pres.hold_group_id,
    p_booking_id: creator.bookingId,
    p_jobber_job_id: creator.jobberJobId ?? null,
    p_jobber_visit_id: creator.jobberVisitId ?? null,
    p_reference_number: creator.referenceNumber ?? null,
    p_booking_result: (creator.raw as any) ?? null,
    p_provider_response: (creator.raw as any) ?? null,
  });
  const commitRes = (commit ?? {}) as any;
  if (commitRes.ok === false) {
    // Jobber succeeded but local commit failed. Keep the hold and record
    // enough context for reconciliation. NEVER a second booking.
    return finishRecoverableFailure(
      executionToken,
      "commit_rpc_failed",
      commitRes.reason ?? "commit_denied",
      bookingInput as any,
      { booking_creator_success: creator, commit_response: commitRes },
      "external_committed_pending_local",
    );
  }

  // Stamp confirmation_pending so the confirmation-SMS sender is the ONLY
  // path that can transition the row to `confirmed`.
  if (ledgerId) {
    await supabase
      .from("sms_booking_confirmations")
      .update({
        status: "confirmation_pending",
        inbound_sms_id: input.inboundSmsId ?? null,
        confirmed_at: now.toISOString(),
      })
      .eq("id", ledgerId);
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
    booking_idempotency_key: bookingIdempotencyKey,
  };
}

// ---------------------------------------------------------------------------
// Default BookingCreator: POSTs to jobber-create-booking. HTTP status +
// response body classify the outcome:
//   2xx + { bookingId }      → success
//   2xx + { success:false }  → verified terminal rejection
//   2xx malformed / no json  → UNKNOWN (keep hold)
//   4xx                      → verified terminal rejection
//   5xx / thrown / timeout   → UNKNOWN (keep hold)
// ---------------------------------------------------------------------------

export function makeHttpBookingCreator(): BookingCreator {
  return async (input) => {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      return { ok: false, code: "unknown", detail: "missing_supabase_env" };
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
        const terminal = resp.status >= 400 && resp.status < 500;
        return {
          ok: false,
          code: terminal ? "rejected" : "unknown",
          detail: `HTTP ${resp.status}: ${bodyText.slice(0, 300)}`,
          raw: json,
        };
      }
      if (!json) {
        return { ok: false, code: "unknown", detail: "malformed_response", raw: null };
      }
      if (json.success === false || !json.bookingId) {
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
      return { ok: false, code: "unknown", detail: e instanceof Error ? e.message : String(e) };
    }
  };
}
