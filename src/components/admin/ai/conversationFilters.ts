// Deterministic mapping of dashboard filters to conversation_state values.
// Kept as a pure module so it can be unit-tested without React.
export type DashboardFilter =
  | "all" | "new" | "active" | "quote_ready" | "manual_review" | "callback_requested"
  | "awaiting_confirmation" | "booked" | "abandoned" | "staff_takeover" | "needs_attention" | "resolved";

export const FILTER_LABELS: Record<DashboardFilter, string> = {
  all: "All",
  new: "New",
  active: "Active",
  quote_ready: "Quote ready",
  manual_review: "Manual review",
  callback_requested: "Callback",
  awaiting_confirmation: "Awaiting confirm",
  booked: "Booked",
  abandoned: "Abandoned",
  staff_takeover: "Staff takeover",
  needs_attention: "Needs attention",
  resolved: "Resolved",
};

export interface ConvoLike {
  conversation_state?: string | null;
  needs_attention?: boolean | null;
  resolved?: boolean | null;
  last_activity_at?: string | null;
  booking_status?: string | null;
}

const ACTIVE_STATES = new Set([
  "new", "identifying_need", "collecting_address", "validating_service_area",
  "collecting_property_details", "pricing", "missing_information",
  "quote_ready", "collecting_contact", "checking_availability",
  "slot_selected", "awaiting_booking_confirmation", "booking_in_progress",
]);

// A conversation is "abandoned" when it stalled mid-journey (not booked/resolved/
// callback/manual review) with no activity for 24h+.
export function isAbandoned(c: ConvoLike, now = Date.now()): boolean {
  const st = c.conversation_state ?? "new";
  if (c.resolved || ["booked", "callback_requested", "manual_review", "staff_takeover"].includes(st)) return false;
  if (!ACTIVE_STATES.has(st)) return false;
  const last = c.last_activity_at ? new Date(c.last_activity_at).getTime() : now;
  return now - last > 24 * 60 * 60 * 1000;
}

export function matchesFilter(c: ConvoLike, filter: DashboardFilter, now = Date.now()): boolean {
  const st = c.conversation_state ?? "new";
  switch (filter) {
    case "all": return true;
    case "new": return st === "new" || st === "identifying_need";
    case "active": return ACTIVE_STATES.has(st) && !isAbandoned(c, now) && !c.resolved;
    case "quote_ready": return st === "quote_ready";
    case "manual_review": return st === "manual_review";
    case "callback_requested": return st === "callback_requested";
    case "awaiting_confirmation": return st === "awaiting_booking_confirmation";
    case "booked": return st === "booked";
    case "abandoned": return isAbandoned(c, now);
    case "staff_takeover": return st === "staff_takeover";
    case "needs_attention": return !!c.needs_attention && !c.resolved;
    case "resolved": return !!c.resolved || st === "resolved";
    default: return true;
  }
}
