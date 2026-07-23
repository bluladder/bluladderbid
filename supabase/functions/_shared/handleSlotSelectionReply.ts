// ============================================================================
// handleSlotSelectionReply — Phase 4C inbound routing for a customer's SMS
// reply that MAY be a slot selection.
//
// Runs BEFORE the AI conversational orchestrator. Only activates when the
// conversation has an ACTIVE presentation AND the inbound is not STOP/START.
// Otherwise short-circuits with `handled: false` and the caller falls through
// to the normal AI path.
//
// HARD RULES
//   * Reads authoritative slot start/end from the persisted `options` — never
//     from model input.
//   * Runs one deterministic parser against the newest active presentation.
//   * Re-validates context (identity / property / quote inputs / pricing) at
//     reply time. Any drift ⇒ `context_invalidated` and the presentation is
//     invalidated; the customer is told fresh options are needed.
//   * Every outbound reply goes through sendAutonomousCallRailSms with
//     action_class="scheduling". Safety-gate denial keeps the parser result
//     but sends nothing.
//   * Never reserves, holds, confirms, or books.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  attachSelectionAckSms,
  getActivePresentation,
  recordSelection,
  type PresentationRow,
} from "./presentation.ts";
import { parseSlotSelection, type PresentedOption } from "./slotSelectionParser.ts";
import { getBookingReadiness } from "./bookingReadiness.ts";
import { sendAutonomousCallRailSms } from "./autonomousSendGate.ts";
import { getCallRailConfig } from "./sms.ts";
import {
  HOLD_TTL_MINUTES,
  persistHoldState,
  releaseHold,
  reserveAuthoritativeSlot,
  revalidateSelectedSlot,
} from "./slotHold.ts";

type SB = any;

export interface HandleSelectionInput {
  conversationId: string;
  phone: string;
  inboundSmsId: string;
  inboundText: string;
  /** STOP/START compliance is handled elsewhere; skip parser for those. */
  isCompliance?: boolean;
}

export interface HandleSelectionResult {
  handled: boolean;
  action?:
    | "selected"
    | "held"
    | "slot_filled"
    | "revalidation_failed"
    | "reserve_conflict"
    | "ambiguous"
    | "no_match"
    | "expired_options"
    | "context_invalidated"
    | "gate_blocked"
    | "no_active_presentation"
    | "sent_failed";
  presentation?: PresentationRow | null;
  clarification?: string | null;
  selectedSlotId?: string | null;
  selectedStart?: string | null;
  selectedEnd?: string | null;
  holdGroupId?: string | null;
  holdExpiresAt?: string | null;
}

function toPresentedOptions(row: PresentationRow): PresentedOption[] {
  return (row.options ?? []).map((o: any) => ({
    option_number: Number(o.option_number),
    slot_id: String(o.slot_id),
    start_at: String(o.start_at),
    end_at: String(o.end_at),
    timezone: String(o.timezone),
  }));
}

/** Deterministic acknowledgment when the customer picked a specific option. */
function ackForSelectedSlot(row: PresentationRow, optNumber: number): string {
  const opt = (row.options as any[]).find(
    (o) => Number(o.option_number) === optNumber,
  );
  if (!opt) return "Got it — I'll verify that opening and follow up.";
  const startFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: opt.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(opt.start_at));
  const window = opt.customer_label ?? opt.arrival_window_label ?? "";
  return `${startFmt} at ${window} is your preferred time. I'll verify that opening and send the final booking summary next.`;
}

/** Body used AFTER a successful 8-minute hold. Deterministic — never rewritten
 *  by the model. */
function ackForHeldSlot(
  row: PresentationRow,
  optNumber: number,
  expiresAtIso: string,
): string {
  const opt = (row.options as any[]).find(
    (o) => Number(o.option_number) === optNumber,
  );
  if (!opt) {
    return `I'm holding that opening for you for ${HOLD_TTL_MINUTES} minutes.`;
  }
  const startFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: opt.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(opt.start_at));
  const window = opt.customer_label ?? opt.arrival_window_label ?? "";
  const expiresFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: opt.timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(expiresAtIso));
  return `I'm holding ${startFmt} at ${window} for ${HOLD_TTL_MINUTES} minutes (until ${expiresFmt}). I'll send the final booking summary next.`;
}

const SLOT_FILLED_BODY =
  "That opening just filled — let me pull fresh times for you.";

/** Re-check the drift-sensitive slice of readiness at reply time. Returns a
 *  reason string when the current context no longer matches what we captured
 *  when the presentation was created. */
async function detectContextDrift(
  supabase: SB,
  conversationId: string,
  presentation: PresentationRow,
): Promise<string | null> {
  const readiness = await getBookingReadiness(supabase, conversationId);
  if (readiness.identity.status !== "resolved") return "identity_changed";
  if (
    presentation.property_id &&
    !(readiness.property.selected && readiness.property.authorized)
  ) return "property_changed";
  const currentInputsKey = readiness.quote.inputs_key_present
    ? (readiness as any).quote?.inputs_key ?? null
    : null;
  // inputs_current is the authoritative drift check; use it directly.
  if (presentation.inputs_key && !readiness.quote.inputs_current) return "quote_inputs_changed";
  if (
    presentation.pricing_version &&
    readiness.quote.pricing_version &&
    presentation.pricing_version !== readiness.quote.pricing_version
  ) return "pricing_version_changed";
  return null;
}

export async function handleSlotSelectionReply(
  supabase: SB,
  input: HandleSelectionInput,
): Promise<HandleSelectionResult> {
  if (input.isCompliance) return { handled: false };
  const { row, expired } = await getActivePresentation(supabase, input.conversationId);
  if (!row) return { handled: false, action: "no_active_presentation" };

  let clarification: string | null = null;
  let selection:
    | { status: "selected"; optionNumber: number; slotId: string; start: string; end: string }
    | null = null;
  let parseStatus: "selected" | "ambiguous" | "no_match" | "expired_options" | "context_invalidated" =
    "no_match";
  let invalidationReason: string | null = null;

  if (expired) {
    parseStatus = "expired_options";
    clarification =
      "Those appointment options are no longer current. I'll check the schedule again.";
  } else {
    // Context drift check BEFORE trusting the parser result.
    const drift = await detectContextDrift(supabase, input.conversationId, row);
    if (drift) {
      parseStatus = "context_invalidated";
      invalidationReason = drift;
      clarification =
        "Those appointment options are no longer current. I'll check the schedule again.";
    } else {
      const parsed = parseSlotSelection({
        text: input.inboundText,
        options: toPresentedOptions(row),
        expired: false,
      });
      parseStatus = parsed.status;
      clarification = parsed.clarification_message;
      if (parsed.status === "selected" && parsed.matched_option_number != null) {
        const opt = (row.options as any[]).find(
          (o) => Number(o.option_number) === parsed.matched_option_number,
        );
        if (opt) {
          selection = {
            status: "selected",
            optionNumber: parsed.matched_option_number,
            slotId: String(opt.slot_id),
            start: String(opt.start_at),
            end: String(opt.end_at),
          };
        }
      }
    }
  }

  // Persist parser result (idempotent per inbound_sms_id via partial index).
  await recordSelection(supabase, {
    presentationId: row.id,
    inboundSmsId: input.inboundSmsId,
    replyText: input.inboundText,
    status: parseStatus,
    matchedOptionNumber: selection?.optionNumber ?? null,
    invalidationReason,
  });

  // Build the outbound body.
  const body = selection
    ? ackForSelectedSlot(row, selection.optionNumber)
    : clarification ??
      "Reply with the option number (1, 2, or 3) to pick a time.";

  const callrail = getCallRailConfig();
  if (!callrail) {
    return {
      handled: true,
      action: parseStatus === "selected" ? "selected" : parseStatus,
      presentation: row,
      clarification,
      selectedSlotId: selection?.slotId ?? null,
      selectedStart: selection?.start ?? null,
      selectedEnd: selection?.end ?? null,
    };
  }

  const outcome = await sendAutonomousCallRailSms(supabase, {
    conversationId: input.conversationId,
    phone: input.phone,
    actionClass: "scheduling",
    body,
    callRail: callrail,
    messageKind: selection ? "ai_slot_selection_ack" : "ai_slot_selection_clarify",
    where: "handleSlotSelectionReply",
    extraLog: {
      presentation_id: row.id,
      parse_status: parseStatus,
      option_number: selection?.optionNumber ?? null,
    },
  });

  if (outcome.sent && outcome.smsMessageId) {
    await attachSelectionAckSms(supabase, row.id, outcome.smsMessageId);
  }

  return {
    handled: true,
    action: !outcome.sent
      ? outcome.decision.allow
        ? "sent_failed"
        : "gate_blocked"
      : parseStatus === "selected"
      ? "selected"
      : parseStatus,
    presentation: row,
    clarification,
    selectedSlotId: selection?.slotId ?? null,
    selectedStart: selection?.start ?? null,
    selectedEnd: selection?.end ?? null,
  };
}