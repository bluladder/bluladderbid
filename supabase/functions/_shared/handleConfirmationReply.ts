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
function confirmationSmsBody(exec: ExecuteBookingResult): string {
  const start = exec.scheduled_start ? new Date(exec.scheduled_start) : null;
  const tz = exec.timezone ?? "America/Chicago";
  const when = start
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(start)
    : "your requested time";
  const ref = exec.reference_number ? ` Confirmation #${exec.reference_number}.` : "";
  return `You're booked for ${when}.${ref} We'll text you a reminder before we arrive. Reply HELP for support.`;
}

const DECLINE_ACK =
  "No problem — that hold's released. Reply here when you're ready and I'll pull fresh options.";

const BOOKING_FAILED_BODY =
  "I hit a snag finalizing that booking. Our team will follow up shortly to lock it in.";

export async function handleConfirmationReply(
  supabase: SB,
  input: HandleConfirmationInput,
  deps: HandleConfirmationDeps = {},
): Promise<HandleConfirmationResult> {
  if (input.isCompliance) return { handled: false };

  const { row, expired } = await getActivePresentation(supabase, input.conversationId);
  if (!row) return { handled: false, action: "no_active_presentation" };
  if (row.hold_status !== "held") return { handled: false, action: "hold_not_held" };

  // If the hold TTL has elapsed, defer to the slot-selection / AI handlers.
  // Presentation expiry sweeper will flip the row asynchronously.
  const now = deps.now ? deps.now() : new Date();
  if (
    !row.hold_expires_at ||
    new Date(row.hold_expires_at).getTime() <= now.getTime() ||
    expired
  ) {
    return { handled: false, action: "hold_expired", presentation: row };
  }

  const parsed = parseConfirmationReply(input.inboundText);
  const callrail = getCallRailConfig();

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
    const outcome = await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "booking_confirmation",
      body: confirmationSmsBody(execution),
      callRail: callrail,
      messageKind: "ai_booking_confirmed",
      where: "handleConfirmationReply",
      extraLog: {
        presentation_id: row.id,
        booking_id: execution.booking_id,
        ledger_id: execution.ledger_id,
      },
    });
    if (outcome.sent && outcome.smsMessageId && execution.ledger_id) {
      await supabase
        .from("sms_booking_confirmations")
        .update({ confirmation_ack_sms_id: outcome.smsMessageId })
        .eq("id", execution.ledger_id);
    }
    return {
      handled: true,
      action: !outcome.sent
        ? outcome.decision.allow
          ? "sent_failed"
          : "gate_blocked"
        : "confirmed",
      execution,
      presentation: row,
    };
  }

  // Booking failed. NEVER send a confirmation body. Send a bounded fallback.
  if (callrail) {
    await sendAutonomousCallRailSms(supabase, {
      conversationId: row.conversation_id,
      phone: input.phone,
      actionClass: "scheduling",
      body: BOOKING_FAILED_BODY,
      callRail: callrail,
      messageKind: "ai_booking_failed_followup",
      where: "handleConfirmationReply",
      extraLog: {
        presentation_id: row.id,
        error_code: execution.error_code,
      },
    });
  }
  return {
    handled: true,
    action: "booking_failed",
    execution,
    presentation: row,
  };
}