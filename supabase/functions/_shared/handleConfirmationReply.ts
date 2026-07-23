// ============================================================================
// handleConfirmationReply — Phase 6A inbound routing for a customer's SMS
// reply that MAY be a YES/NO to a currently held 8-minute slot hold.
//
// Runs BEFORE handleSlotSelectionReply. Only activates when the newest active
// presentation on this conversation has hold_status='held' AND hold_expires_at
// is still in the future. Otherwise short-circuits with { handled: false } and
// the caller falls through to the slot-selection handler (customer might be
// reselecting) and then to the general AI orchestrator.
//
// HARD RULES
//   * YES  → executeSmsBooking; only on success is a confirmation SMS sent.
//   * NO   → release the hold, mark presentation cancelled, send a plain
//            decline acknowledgement, do NOT create a booking.
//   * Unclear reply → send a bounded YES/NO clarification. Hold stays intact
//            until it naturally expires (already covered by Phase 5 sweeper).
//   * Every outbound goes through sendAutonomousCallRailSms with an explicit
//            actionClass — booking-confirmation success uses "booking",
//            decline / clarification use "scheduling".
//   * Never re-sends a confirmation body derived from a failed booking.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { getActivePresentation, type PresentationRow } from "./presentation.ts";
import { parseConfirmationReply, CLARIFICATION_ASK } from "./confirmationParser.ts";
import { sendAutonomousCallRailSms } from "./autonomousSendGate.ts";
import { getCallRailConfig } from "./sms.ts";
import { releaseHold } from "./slotHold.ts";
import { sendOutboxSms } from "./smsOutbox.ts";
import {
  resolveBookingTimezone,
  formatBookingWhen,
  BLULADDER_DEFAULT_TIMEZONE,
} from "./bookingTimezone.ts";
import {
  executeSmsBooking,
  makeHttpBookingCreator,
  type BookingCreator,
  type ExecuteBookingResult,
} from "./executeSmsBooking.ts";

type SB = any;

export interface HandleConfirmationInput {
  conversationId: string;
  phone: string;
  inboundSmsId: string;
  inboundText: string;
  /** Compliance replies (STOP/START) are handled upstream. */
  isCompliance?: boolean;
}

export interface HandleConfirmationResult {
  handled: boolean;
  action?:
    | "no_active_presentation"
    | "hold_not_held"
    | "hold_expired"
    | "confirmed"
    | "duplicate_confirmation"
    | "declined"
    | "unclear"
    | "booking_failed"
    | "booking_failed_recoverable"
    | "in_progress"
    | "gate_blocked"
    | "sent_failed";
  execution?: ExecuteBookingResult | null;
  presentation?: PresentationRow | null;
}

export interface HandleConfirmationDeps {
  bookingCreator?: BookingCreator;
  now?: () => Date;
}

// Deterministic bodies — chosen from state, not from an LLM.
// Phase 6B.3: timezone comes from the resolver, not from an ad-hoc field on
// the execution result. That way DST is always correct and the same zone
// used to format the customer SMS is also persisted on the ledger.
export function confirmationSmsBody(
  exec: ExecuteBookingResult,
  timezone: string,
): string {
  const when = formatBookingWhen(exec.scheduled_start ?? null, timezone);
  const ref = exec.reference_number ? ` Confirmation #${exec.reference_number}.` : "";
  return `You're booked for ${when}.${ref} We'll text you a reminder before we arrive. Reply HELP for support.`;
}

const DECLINE_ACK =
  "No problem — that hold's released. Reply here when you're ready and I'll pull fresh options.";

const BOOKING_FAILED_BODY =
  "I hit a snag finalizing that booking. Our team will follow up shortly to lock it in.";

// UNKNOWN external outcome — the reservation is still held and reconciliation
// will resolve truth. Do NOT tell the customer it failed.
const BOOKING_UNCERTAIN_BODY =
  "Thanks — I'm locking that in now. I'll send your confirmation as soon as it clears (usually under a minute).";

// Phase 6B.1 — deterministic expired-hold responses. Split by parsed intent:
//   * YES on an expired hold → tell the customer the window lapsed and invite
//     them to pull fresh times. (Availability itself is Phase 4C — this text
//     only signals readiness to route, not a new presentation.)
//   * NO on an expired hold → acknowledge that nothing was booked. Do NOT
//     invite fresh availability; the customer just declined.
// Unclear replies fall through to the AI orchestrator.
const EXPIRED_HOLD_YES_BODY =
  "That 8-minute hold just expired, so I didn't book it. Reply here and I'll pull fresh times for you.";
const EXPIRED_HOLD_NO_BODY =
  "Understood — nothing was booked. That hold already expired on its own. Reply here anytime and we'll pick it back up.";

export async function handleConfirmationReply(
  supabase: SB,
  input: HandleConfirmationInput,
  deps: HandleConfirmationDeps = {},
): Promise<HandleConfirmationResult> {
  if (input.isCompliance) return { handled: false };

  const { row, expired } = await getActivePresentation(supabase, input.conversationId);
  if (!row) return { handled: false, action: "no_active_presentation" };
  if (row.hold_status !== "held") return { handled: false, action: "hold_not_held" };

  const now = deps.now ? deps.now() : new Date();
  const holdExpired =
    !row.hold_expires_at ||
    new Date(row.hold_expires_at).getTime() <= now.getTime() ||
    expired;

  const parsed = parseConfirmationReply(input.inboundText);
  const callrail = getCallRailConfig();

  // Phase 6B.1 — deterministic expired-hold response. If the reply is a
  // recognisable YES/NO but the 8-minute hold already elapsed, tell the
  // customer explicitly and stop routing. Unclear replies fall through so
  // the AI orchestrator can handle unrelated intents.
  if (holdExpired) {
    if (parsed.status === "unclear") {
      return { handled: false, action: "hold_expired", presentation: row };
    }
    const expiredBody = parsed.status === "declined"
      ? EXPIRED_HOLD_NO_BODY
      : EXPIRED_HOLD_YES_BODY;
    const expiredKind = parsed.status === "declined"
      ? "ai_hold_expired_declined_ack"
      : "ai_hold_expired_ack";
    if (!callrail) return { handled: true, action: "hold_expired", presentation: row };
    const outcome = await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "scheduling",
      body: expiredBody,
      callRail: callrail,
      messageKind: expiredKind,
      outboundIdempotencyKey: `hold_expired:${parsed.status}:${row.id}`,
      where: "handleConfirmationReply",
      extraLog: { presentation_id: row.id, parse: parsed.status },
    });
    return {
      handled: true,
      action: !outcome.sent
        ? outcome.decision.allow ? "sent_failed" : "gate_blocked"
        : "hold_expired",
      presentation: row,
    };
  }

  // ---------- unclear → clarification -------------------------------------
  if (parsed.status === "unclear") {
    if (!callrail) return { handled: true, action: "unclear", presentation: row };
    const outcome = await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "scheduling",
      body: parsed.clarification_message ?? CLARIFICATION_ASK,
      callRail: callrail,
      messageKind: "ai_confirmation_clarify",
      where: "handleConfirmationReply",
      extraLog: { presentation_id: row.id, parse: "unclear" },
    });
    return {
      handled: true,
      action: !outcome.sent
        ? outcome.decision.allow
          ? "sent_failed"
          : "gate_blocked"
        : "unclear",
      presentation: row,
    };
  }

  // ---------- decline → release hold + acknowledgement --------------------
  if (parsed.status === "declined") {
    if (row.hold_group_id) {
      try {
        await releaseHold(
          supabase,
          row.id,
          row.hold_group_id,
          "customer_declined_confirmation",
        );
      } catch { /* best effort */ }
    }
    // Mark the presentation cancelled so the next presentation flow is clean.
    try {
      await supabase
        .from("sms_availability_presentations")
        .update({ status: "cancelled" })
        .eq("id", row.id);
    } catch { /* best effort */ }

    if (!callrail) return { handled: true, action: "declined", presentation: row };
    const outcome = await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "scheduling",
      body: DECLINE_ACK,
      callRail: callrail,
      messageKind: "ai_confirmation_declined",
      where: "handleConfirmationReply",
      extraLog: { presentation_id: row.id, parse: "declined" },
    });
    return {
      handled: true,
      action: !outcome.sent
        ? outcome.decision.allow
          ? "sent_failed"
          : "gate_blocked"
        : "declined",
      presentation: row,
    };
  }

  // ---------- confirmed → execute booking ---------------------------------
  const bookingCreator = deps.bookingCreator ?? makeHttpBookingCreator();
  const execution = await executeSmsBooking(
    supabase,
    { presentationId: row.id, inboundSmsId: input.inboundSmsId },
    { bookingCreator, now: deps.now },
  );

  if (execution.status === "confirmed" || execution.status === "duplicate_confirmation") {
    if (!callrail) {
      return {
        handled: true,
        action: execution.status === "duplicate_confirmation"
          ? "duplicate_confirmation"
          : "confirmed",
        execution,
        presentation: row,
      };
    }
    // Duplicate YES: do NOT re-send a confirmation body. Ledger already sent.
    if (execution.status === "duplicate_confirmation") {
      return { handled: true, action: "duplicate_confirmation", execution, presentation: row };
    }
    // Phase 6B.3: booking-confirmation SMS goes through the outbox state
    // machine so a crash after CallRail dispatch cannot produce a duplicate
    // "you're booked" text. Resolve the timezone once, persist it on the
    // ledger, and use the same value to render the customer body.
    const timezone =
      execution.timezone ??
      resolveBookingTimezone({ presentation: row, property: null }) ??
      BLULADDER_DEFAULT_TIMEZONE;
    if (execution.ledger_id) {
      await supabase
        .from("sms_booking_confirmations")
        .update({ booking_timezone: timezone })
        .eq("id", execution.ledger_id)
        .is("booking_timezone", null);
    }
    const outboundKey = execution.ledger_id
      ? `booking_confirmation:${execution.ledger_id}`
      : `booking_confirmation_pres:${row.id}`;
    const outbox = await sendOutboxSms(supabase, {
      outboundKey,
      toNumber: input.phone,
      body: confirmationSmsBody(execution, timezone),
      messageKind: "ai_booking_confirmed",
      callRail: callrail,
    });
    if (outbox.smsMessageId && execution.ledger_id) {
      // Attach evidence regardless of send outcome — even a delivery_unknown
      // row is the authoritative dispatch record for this ledger.
      const patch: Record<string, unknown> = {
        confirmation_ack_sms_id: outbox.smsMessageId,
      };
      if (outbox.sent) patch.status = "confirmed";
      await supabase
        .from("sms_booking_confirmations")
        .update(patch)
        .eq("id", execution.ledger_id);
    }
    return {
      handled: true,
      action: outbox.sent ? "confirmed" : "sent_failed",
      execution,
      presentation: row,
    };
  }

  // In-progress: another worker holds the execution claim. Stay silent —
  // that worker will send the confirmation SMS on success.
  if (execution.status === "in_progress") {
    return { handled: true, action: "in_progress", execution, presentation: row };
  }

  // Recoverable failure: external outcome UNKNOWN. Hold is preserved.
  // Never tell the customer it failed.
  const recoverable = execution.status === "failed_recoverable"
    || execution.preserve_customer_uncertainty === true;

  if (callrail) {
    await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "scheduling",
      body: recoverable ? BOOKING_UNCERTAIN_BODY : BOOKING_FAILED_BODY,
      callRail: callrail,
      messageKind: recoverable
        ? "ai_booking_pending_reconciliation"
        : "ai_booking_failed_followup",
      outboundIdempotencyKey: execution.ledger_id
        ? `booking_${recoverable ? "pending" : "failed"}:${execution.ledger_id}`
        : null,
      where: "handleConfirmationReply",
      extraLog: {
        presentation_id: row.id,
        error_code: execution.error_code,
        recoverable,
      },
    });
  }
  return {
    handled: true,
    action: recoverable ? "booking_failed_recoverable" : "booking_failed",
    execution,
    presentation: row,
  };
}