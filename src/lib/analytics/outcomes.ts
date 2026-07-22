// Deterministic conversation outcome classifier.
//
// Design goals (per product requirements):
//   * Prefer deterministic signals; only fall back to AI when nothing else fits.
//   * `booking_completed` (any linked booking in a booked lifecycle state) always
//     produces a booked_* outcome.
//   * Explicit decline is never re-classified as inactivity.
//   * Provider / tool failures are never classified as customer abandonment.
//   * Active conversations (age < inactivity threshold, not resolved) are never
//     classified as inactive.
//   * When AI inference is used, we persist `confidence` and `classifier_version`.
//
// The classifier is pure: given a `ConversationSnapshot`, it returns a
// `ClassifiedOutcome`. Persistence is handled elsewhere.

export const OUTCOMES = [
  "booked_automatically",
  "booked_after_human_assistance",
  "quote_not_booked",
  "waiting_on_customer",
  "customer_inactive",
  "explicit_decline",
  "outside_service_area",
  "unsupported_scope",
  "human_escalation",
  "complaint_or_service_issue",
  "ai_or_tool_failure",
  "duplicate_or_spam",
  "unknown",
] as const;

export type Outcome = typeof OUTCOMES[number];

export type BookingLifecycleStatus =
  | "pending"
  | "confirmed"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "pending_confirmation"
  | "needs_attention";

export const BOOKED_STATUSES: ReadonlySet<BookingLifecycleStatus> = new Set([
  "confirmed",
  "scheduled",
  "in_progress",
  "completed",
  "pending_confirmation",
]);

export type LinkedBooking = {
  id: string;
  status: BookingLifecycleStatus;
  created_at: string;
};

export type ConversationSnapshot = {
  id: string;
  created_at: string;
  last_activity_at: string;
  resolved: boolean;
  staff_takeover_at: string | null;
  booking_status: string; // chat_conversations.booking_status
  bookings: LinkedBooking[];
  has_quote: boolean;
  quote_declined: boolean;
  service_area_status: string | null; // e.g. 'out_of_area'
  unsupported_scope: boolean;
  last_error: string | null;
  escalation_open: boolean;
  complaint: boolean;
  spam: boolean;
  turns: number;
  ai_classification?: {
    outcome: Outcome;
    confidence: number; // 0..1
    version: string;
  } | null;
};

export type ClassifierOptions = {
  now?: Date;
  /** Minutes of inactivity before a conversation is considered inactive. */
  inactivityThresholdMinutes: number;
};

export type ClassifiedOutcome = {
  outcome: Outcome;
  deterministic: boolean;
  reason: string;
  confidence: number;
  classifier_version: string;
  evidence: Record<string, unknown>;
};

export const CLASSIFIER_VERSION = "outcomes.v1";

// Provider / tool-failure markers: any of these substrings in `last_error`
// short-circuit into `ai_or_tool_failure`, so a transient outage is never
// recorded as customer abandonment.
const PROVIDER_FAILURE_MARKERS = [
  "provider_",
  "ai_error",
  "ai_gateway",
  "tool_error",
  "tool_failure",
  "gateway_",
  "resend_",
  "twilio_",
  "callrail_",
  "jobber_",
];

function isProviderFailure(err: string | null): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return PROVIDER_FAILURE_MARKERS.some((m) => lower.includes(m));
}

function pickBooking(bookings: LinkedBooking[]): LinkedBooking | null {
  for (const b of bookings) {
    if (BOOKED_STATUSES.has(b.status)) return b;
  }
  return null;
}

function ageMinutes(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  return (now.getTime() - t) / 60_000;
}

export function classifyOutcome(
  snap: ConversationSnapshot,
  opts: ClassifierOptions,
): ClassifiedOutcome {
  const now = opts.now ?? new Date();
  const evidence: Record<string, unknown> = {};

  // 1. Deterministic booked outcome — highest precedence.
  const booking = pickBooking(snap.bookings);
  if (booking) {
    const humanAssisted = !!snap.staff_takeover_at &&
      new Date(snap.staff_takeover_at).getTime() <=
        new Date(booking.created_at).getTime();
    const outcome: Outcome = humanAssisted
      ? "booked_after_human_assistance"
      : "booked_automatically";
    evidence.booking_id = booking.id;
    evidence.booking_status = booking.status;
    evidence.human_assisted = humanAssisted;
    return {
      outcome,
      deterministic: true,
      reason: "linked_booking",
      confidence: 1,
      classifier_version: CLASSIFIER_VERSION,
      evidence,
    };
  }

  // 2. Spam / duplicate.
  if (snap.spam) {
    return det("duplicate_or_spam", "spam_flag", { spam: true });
  }

  // 3. Provider / tool failure — must never be re-labeled abandonment.
  if (isProviderFailure(snap.last_error)) {
    return det("ai_or_tool_failure", "provider_failure", {
      last_error: snap.last_error,
    });
  }

  // 4. Explicit decline — must never fall through to inactivity.
  if (snap.quote_declined) {
    return det("explicit_decline", "quote_declined", {});
  }

  // 5. Out of service area / unsupported scope (only when there is no booking).
  if (snap.service_area_status === "out_of_area") {
    return det("outside_service_area", "service_area", {
      service_area_status: snap.service_area_status,
    });
  }
  if (snap.unsupported_scope) {
    return det("unsupported_scope", "unsupported_scope_flag", {});
  }

  // 6. Human escalation still open.
  if (snap.escalation_open) {
    return det("human_escalation", "escalation_open", {});
  }

  // 7. Complaint or post-service issue.
  if (snap.complaint) {
    return det("complaint_or_service_issue", "complaint_flag", {});
  }

  // 8. Activity vs inactivity — active always wins over inactive.
  const age = ageMinutes(snap.last_activity_at, now);
  const active = !snap.resolved && age < opts.inactivityThresholdMinutes;

  if (active) {
    return det("waiting_on_customer", "active_within_threshold", {
      age_minutes: age,
      threshold_minutes: opts.inactivityThresholdMinutes,
    });
  }

  // 9. Quote produced but never converted.
  if (snap.has_quote) {
    return det("quote_not_booked", "quote_no_conversion", {
      age_minutes: age,
    });
  }

  // 10. Cold conversation past threshold.
  if (age >= opts.inactivityThresholdMinutes) {
    return det("customer_inactive", "inactivity_threshold_exceeded", {
      age_minutes: age,
      threshold_minutes: opts.inactivityThresholdMinutes,
    });
  }

  // 11. Unstructured fallback — AI inference allowed here only.
  if (snap.ai_classification) {
    const ai = snap.ai_classification;
    return {
      outcome: ai.outcome,
      deterministic: false,
      reason: "ai_inference",
      confidence: ai.confidence,
      classifier_version: ai.version,
      evidence: { ai: true },
    };
  }

  return det("unknown", "no_signal", {});
}

function det(
  outcome: Outcome,
  reason: string,
  evidence: Record<string, unknown>,
): ClassifiedOutcome {
  return {
    outcome,
    deterministic: true,
    reason,
    confidence: 1,
    classifier_version: CLASSIFIER_VERSION,
    evidence,
  };
}
