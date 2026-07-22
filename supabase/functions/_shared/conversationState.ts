// ============================================================================
// conversationState.ts — DETERMINISTIC conversation state machine.
//
// The model may generate natural language, but it can NEVER decide which
// information is complete, which tool may run, whether a quote/slot is still
// valid, or whether booking is authorized. Those decisions are computed here
// from server-side structured facts — not from prompt history.
//
// This module has ZERO external imports so it is provider-independent and can
// be unit-tested directly (Deno). Both website chat and a future voice channel
// share it unchanged.
// ============================================================================

export type ConversationState =
  | "new"
  | "identifying_need"
  | "voice_rough_quote"
  | "collecting_address"
  | "validating_service_area"
  | "collecting_property_details"
  | "pricing"
  | "missing_information"
  | "manual_review"
  | "quote_ready"
  | "collecting_contact"
  | "checking_availability"
  | "slot_selected"
  | "awaiting_booking_confirmation"
  | "booking_in_progress"
  | "booked"
  | "callback_requested"
  | "staff_takeover"
  | "resolved"
  | "error_recovery";

export type ToolName =
  | "calculate_bluladder_quote"
  | "get_bluladder_availability"
  | "create_bluladder_booking"
  | "validate_service_area"
  | "request_manual_quote"
  | "request_human_callback"
  | "escalate_to_human"
  | "record_consent";

// Structured, server-authoritative facts. Corrections update these directly and
// invalidate everything computed downstream (quote -> availability -> slot).
export interface ConversationFacts {
  services?: string[];
  address?: string;
  serviceArea?: { status?: string; formattedAddress?: string; reason?: string } | null;
  property?: {
    squareFootage?: number;
    stories?: number;
    windowCleaningType?: string;
    condition?: string;
    roofType?: string;
    roofSeverity?: string;
    drivewaySqft?: number;
    drivewaySurface?: string;
    pressureWashSqft?: number;
    pressureWashSurface?: string;
  };
  promotionId?: string | null;
  discountCode?: string | null;
  quote?: {
    status?: string; // firm | estimated | missing_information | manual_review_required | pricing_unavailable | error
    firm?: boolean;
    total?: number | null;
    lineItems?: unknown[];
    pricingVersion?: number | null;
    engineVersion?: string | null;
    inputsKey?: string; // signature of the inputs that produced this quote
  } | null;
  contact?: { name?: string; email?: string; phone?: string };
  consent?: { marketing?: boolean };
  availability?: {
    offeredSlotIds?: string[];
    forQuoteKey?: string; // quote inputsKey the slots were fetched for
    fetchedAt?: string;
  } | null;
  selectedSlotId?: string | null;
  manualReviewReason?: string | null;
  callbackRequested?: boolean;
  bookingStatus?: string; // none | quoted | confirmed | needs_attention | failed
  needsAttention?: boolean;
  staffTakeover?: boolean;
  resolved?: boolean;
  lastError?: string | null;
  roughQuote?: {
    intent?: boolean;
    city?: string;
    cityStatus?: "normal_service_city" | "unknown_or_outside" | "lookup_unavailable";
  };
}

const MANUAL_REVIEW_STATES = ["manual_review_required"];

// ---------------------------------------------------------------------------
// Input signatures: any change to these invalidates the dependent result.
// ---------------------------------------------------------------------------
export function quoteInputsKey(f: ConversationFacts): string {
  const services = [...(f.services ?? [])].sort();
  const p = f.property ?? {};
  return JSON.stringify({
    services,
    address: (f.address ?? "").trim().toLowerCase(),
    sqft: p.squareFootage ?? null,
    stories: p.stories ?? null,
    windowType: p.windowCleaningType ?? null,
    condition: p.condition ?? null,
    roofType: p.roofType ?? null,
    roofSeverity: p.roofSeverity ?? null,
    drivewaySqft: p.drivewaySqft ?? null,
    drivewaySurface: p.drivewaySurface ?? null,
    pwSqft: p.pressureWashSqft ?? null,
    pwSurface: p.pressureWashSurface ?? null,
    discount: f.discountCode ?? null,
    promotion: f.promotionId ?? null,
  });
}

// True when the stored quote still matches the current inputs.
export function isQuoteCurrent(f: ConversationFacts): boolean {
  const q = f.quote;
  if (!q || !q.inputsKey) return false;
  if (q.status === "pricing_unavailable" || q.status === "error") return false;
  return q.inputsKey === quoteInputsKey(f);
}

export function isQuoteFirm(f: ConversationFacts): boolean {
  return isQuoteCurrent(f) && f.quote?.firm === true && f.quote?.status === "firm";
}

export function isQuoteEstimatedOrFirm(f: ConversationFacts): boolean {
  return isQuoteCurrent(f) && (f.quote?.status === "firm" || f.quote?.status === "estimated");
}

// Availability is fresh only when it was fetched for the CURRENT quote inputs.
export function isAvailabilityCurrent(f: ConversationFacts): boolean {
  const a = f.availability;
  if (!a || !Array.isArray(a.offeredSlotIds) || a.offeredSlotIds.length === 0) return false;
  if (!isQuoteEstimatedOrFirm(f)) return false;
  return a.forQuoteKey === quoteInputsKey(f);
}

// A selected slot is valid only if it was in the CURRENT availability offer.
export function isSelectedSlotValid(f: ConversationFacts): boolean {
  if (!f.selectedSlotId) return false;
  if (!isAvailabilityCurrent(f)) return false;
  return (f.availability?.offeredSlotIds ?? []).includes(f.selectedSlotId);
}

export function hasContact(f: ConversationFacts): boolean {
  const c = f.contact ?? {};
  return !!(c.email && c.email.trim());
}

export function isServiceAreaEligible(f: ConversationFacts): boolean {
  return f.serviceArea?.status === "eligible";
}

export function isManualReview(f: ConversationFacts): boolean {
  return (
    (f.quote && MANUAL_REVIEW_STATES.includes(f.quote.status ?? "")) ||
    f.serviceArea?.status === "manual_review_required" ||
    !!f.manualReviewReason
  );
}

// ---------------------------------------------------------------------------
// computeState — the single source of truth for "where are we".
// Terminal / override states win first, then the linear journey.
// ---------------------------------------------------------------------------
export function computeState(f: ConversationFacts, channel?: "web" | "voice" | "sms"): ConversationState {
  if (f.staffTakeover) return "staff_takeover";
  if (f.resolved) return "resolved";
  if (f.bookingStatus === "confirmed") return "booked";
  if (f.bookingStatus === "needs_attention" || f.bookingStatus === "failed" || f.needsAttention) {
    // needs_attention is surfaced but callback/manual review are more specific
    if (f.callbackRequested) return "callback_requested";
    if (isManualReview(f)) return "manual_review";
    return "error_recovery";
  }
  if (f.callbackRequested) return "callback_requested";
  if (isManualReview(f)) return "manual_review";

  const hasServices = (f.services ?? []).length > 0;
  if (!hasServices) return f.address || f.serviceArea ? "identifying_need" : "new";

  if (channel === "voice" && !isQuoteCurrent(f)) {
    return "voice_rough_quote";
  }

  if (!f.address) return "collecting_address";
  if (!f.serviceArea) return "validating_service_area";
  if (f.serviceArea.status === "validation_unavailable" || f.serviceArea.status === "address_incomplete") {
    return "validating_service_area";
  }
  if (!isServiceAreaEligible(f)) return "manual_review";

  // Quote lifecycle
  if (!isQuoteCurrent(f)) {
    // If we have an out-of-date/absent quote, we need pricing.
    return "pricing";
  }
  if (f.quote?.status === "missing_information") return "collecting_property_details";
  if (!isQuoteEstimatedOrFirm(f)) return "pricing";

  // We have a current firm/estimated quote.
  if (!hasContact(f)) {
    // quote is presentable but contact is needed before booking
    return "quote_ready";
  }

  if (!isAvailabilityCurrent(f)) return "checking_availability";
  // Slots have been offered for the current quote and we have contact details.
  // The single booking tool carries the chosen slot + explicit confirmation, so
  // this is the ready-to-book state; the tool itself re-resolves/expires slots.
  return "awaiting_booking_confirmation";
}

// ---------------------------------------------------------------------------
// allowedToolsForState — the state machine (not the model) decides which tools
// may run. request_human_callback and record_consent are ALWAYS permitted
// (a customer can ask for a person, or set consent, at any point).
// ---------------------------------------------------------------------------
const ALWAYS_ALLOWED: ToolName[] = ["request_human_callback", "escalate_to_human", "record_consent"];

// Channel-scoped relaxations. The isolated voice beta allows a rough canonical
// quote to be calculated BEFORE an address is collected, so a caller who only
// shares square footage / stories / service type can hear a real price from
// the canonical engine. Address + service-area validation are still required
// downstream for availability, booking, and any customer-specific commitment
// (those tools are NOT added to these states).
const VOICE_EARLY_QUOTE_STATES: ConversationState[] = [
  "collecting_address",
  "validating_service_area",
];

export function allowedToolsForState(
  state: ConversationState,
  channel?: "web" | "voice" | "sms",
): ToolName[] {
  const base: Record<ConversationState, ToolName[]> = {
    new: ["validate_service_area", "request_manual_quote"],
    voice_rough_quote: ["calculate_bluladder_quote", "request_manual_quote"],
    // calculate_bluladder_quote is permitted here so the model can RECORD the
    // requested service(s) once known — services are only persisted by that tool,
    // and computeState cannot advance past identifying_need until they exist.
    // Eligibility ordering is preserved: an ineligible address still routes to
    // manual_review on the next computeState, and validate_service_area remains
    // available so the area is confirmed first.
    identifying_need: ["calculate_bluladder_quote", "validate_service_area", "request_manual_quote"],
    collecting_address: ["validate_service_area", "request_manual_quote"],
    validating_service_area: ["validate_service_area", "request_manual_quote"],
    collecting_property_details: ["calculate_bluladder_quote", "validate_service_area", "request_manual_quote"],
    pricing: ["calculate_bluladder_quote", "validate_service_area", "request_manual_quote"],
    missing_information: ["calculate_bluladder_quote", "request_manual_quote"],
    manual_review: ["request_manual_quote"],
    quote_ready: ["calculate_bluladder_quote", "validate_service_area", "request_manual_quote"],
    collecting_contact: ["calculate_bluladder_quote", "request_manual_quote"],
    checking_availability: ["get_bluladder_availability", "calculate_bluladder_quote"],
    slot_selected: ["get_bluladder_availability", "calculate_bluladder_quote"],
    awaiting_booking_confirmation: ["create_bluladder_booking", "get_bluladder_availability", "calculate_bluladder_quote"],
    booking_in_progress: ["create_bluladder_booking"],
    booked: [],
    callback_requested: ["request_manual_quote"],
    staff_takeover: [],
    resolved: [],
    error_recovery: ["validate_service_area", "calculate_bluladder_quote", "get_bluladder_availability", "request_manual_quote"],
  };
  const set = new Set<ToolName>([...(base[state] ?? []), ...ALWAYS_ALLOWED]);
  if (channel === "voice" && (state === "voice_rough_quote" || VOICE_EARLY_QUOTE_STATES.includes(state))) {
    set.add("calculate_bluladder_quote");
  }
  return [...set];
}

export function isToolAllowed(
  state: ConversationState,
  tool: string,
  channel?: "web" | "voice" | "sms",
): boolean {
  return allowedToolsForState(state, channel).includes(tool as ToolName);
}

// ---------------------------------------------------------------------------
// Fact merging + downstream invalidation. When a customer corrects an input we
// must clear whatever it invalidates so a stale price/slot can never be used.
// ---------------------------------------------------------------------------
export function mergeFacts(prev: ConversationFacts, patch: Partial<ConversationFacts>): ConversationFacts {
  const next: ConversationFacts = {
    ...prev,
    ...patch,
    property: patch.property ? { ...(prev.property ?? {}), ...patch.property } : prev.property,
    contact: patch.contact ? { ...(prev.contact ?? {}), ...patch.contact } : prev.contact,
    consent: patch.consent ? { ...(prev.consent ?? {}), ...patch.consent } : prev.consent,
  };

  // If the quote is no longer current for the new inputs, drop dependent state.
  if (!isQuoteCurrent(next)) {
    next.availability = null;
    next.selectedSlotId = null;
  } else if (!isAvailabilityCurrent(next)) {
    // Quote current but availability was fetched for different inputs.
    next.availability = null;
    next.selectedSlotId = null;
  } else if (next.selectedSlotId && !(next.availability?.offeredSlotIds ?? []).includes(next.selectedSlotId)) {
    next.selectedSlotId = null;
  }
  return next;
}

// A short directive appended to the system prompt so the model's natural
// language matches the deterministic step (it cannot change the step itself).
export function stateDirective(
  state: ConversationState,
  f: ConversationFacts,
  channel?: "web" | "voice" | "sms",
): string {
  const allowed = allowedToolsForState(state, channel).join(", ");
  const lines: string[] = [
    `CURRENT DETERMINISTIC STATE: ${state}.`,
    `You may ONLY call these tools right now: ${allowed}. Any other tool is rejected by the server.`,
  ];
  switch (state) {
    case "new":
      lines.push("Find out which service(s) the customer wants before anything else.");
      break;
    case "identifying_need":
      lines.push(
        "As soon as you know which service(s) the customer wants, call calculate_bluladder_quote with the services list (plus any property details you already have) — this records the service(s) and returns either a price or the exact missing details to ask for. If you don't yet have the address, get it and validate the service area first.",
      );
      break;
    case "voice_rough_quote":
      lines.push(
        "VOICE ROUGH QUOTE MODE: address collection, service-area validation, customer lookup, contact collection, availability, booking, and callback intake must NOT interrupt the rough quote. Ask exactly one missing canonical pricing question at a time. For exterior window cleaning, collect approximate square footage, exterior-only versus full-service inside-and-out, stories, and lightweight city context. Do not ask for window count. Once those inputs are present, call calculate_bluladder_quote immediately. Use canonical/default pricing assumptions only; never invent pricing values. After stating the tool price, ask whether the caller wants to check appointment availability; collect the full street address only after they say yes to availability or booking.",
      );
      break;
    case "collecting_address":
      if (channel === "voice") {
        lines.push(
          "You may calculate a ROUGH quote first (voice beta): if you have the service(s) and the canonical inputs the pricing engine needs (approximate home square footage; for window cleaning also confirm exterior-only vs full-service; stories only if the engine asks), call calculate_bluladder_quote now — do NOT ask for a street address just to get a price. If the caller does not know their approximate square footage, briefly explain the pricing system needs it for a reliable estimate; do NOT invent a range and do NOT collect contact details for manual follow-up unless the caller asks. Collect the full service address ONLY when the caller wants to check availability, book, or get a definitive service-area/eligibility answer.",
        );
      } else {
        lines.push("Collect the full service address (street, city, ZIP) so we can validate the service area.");
      }
      break;
    case "validating_service_area":
      if (channel === "voice") {
        lines.push(
          "You may still calculate a ROUGH canonical quote via calculate_bluladder_quote (voice beta) if pricing inputs are present. Call validate_service_area before making any definitive eligibility statement, offering appointment times, or booking. Never decide eligibility yourself from the city name.",
        );
      } else {
        lines.push("Call validate_service_area. Never decide eligibility yourself from the city name.");
      }
      break;
    case "collecting_property_details":
      lines.push("Ask ONLY for the specific missing property details the quote tool reported, then re-price.");
      break;
    case "pricing":
      lines.push("Call calculate_bluladder_quote to get an authoritative price. Never state a price you did not get from the tool.");
      break;
    case "manual_review":
      lines.push("This needs manual review. Use request_manual_quote and collect details. Do NOT give a firm price.");
      break;
    case "quote_ready":
      lines.push("Present the quote from the tool. To move toward booking, collect the customer's name and email.");
      break;
    case "checking_availability":
      lines.push("Call get_bluladder_availability. Only offer times the tool returns.");
      break;
    case "slot_selected":
      lines.push("Confirm which offered time the customer wants. Only accept a slot from the current offer.");
      break;
    case "awaiting_booking_confirmation":
      lines.push(
        "Show the full summary (name, address, services, line items, total, pricing version, date/time, prep) and ask: 'Would you like me to book this appointment for the date, time and total shown above?' Only call create_bluladder_booking after an UNAMBIGUOUS yes like 'Yes, book it.'",
      );
      break;
    case "booked":
      lines.push("The appointment is booked. Confirm warmly and share what to expect.");
      break;
    case "callback_requested":
      lines.push("A callback was requested. Reassure the customer the team will reach out.");
      break;
    case "staff_takeover":
      lines.push("A team member has taken over this conversation. Do not take further automated actions.");
      break;
    case "error_recovery":
      lines.push("Something went wrong. Recover gracefully, retry the safe step, or offer a human callback. Never expose technical errors.");
      break;
    default:
      break;
  }
  return lines.join("\n");
}
