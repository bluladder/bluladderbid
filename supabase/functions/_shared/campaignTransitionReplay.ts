// ============================================================================
// Canonical replay of persisted `quote_follow_up_completed` events into the
// long-term nurture destination campaign, once that campaign is activated.
//
// Historical completions were processed while the destination campaign was
// inactive. The canonical campaign-event ingress stores `decisions: []` for
// those events and returns the SAME empty decisions when its idempotency key
// is replayed — reposting the original key is NOT a valid backfill path.
//
// This module provides:
//   * A deterministic REPLAY idempotency key that is distinct from the
//     original completion event key.
//   * A pure eligibility gate so every rule the requirements call out is
//     testable offline.
//   * A dry-run reporter that never writes.
//   * A live runner that submits ONLY through campaign-event — it never
//     inserts into campaign_enrollments or sms_messages directly.
// ============================================================================

export type BackfillOutcome =
  | "eligible"
  | "already_replayed"
  | "already_enrolled"
  | "booked"
  | "no_consent"
  | "opted_out"
  | "suppressed"
  | "human_takeover"
  | "superseded"
  | "invalid_event";

export interface BackfillEligibilityInput {
  hasEventId: boolean;
  hasCustomerIdentity: boolean;      // customer_id or (email|phone) present
  alreadyReplayed: boolean;          // a prior successful replay for this (event, dest, ver)
  alreadyEnrolledInDestination: boolean;
  hasBooking: boolean;
  marketingConsentGranted: boolean;
  optedOut: boolean;
  suppressed: boolean;
  humanTakeover: boolean;
  supersededByNewerQuoteLifecycle: boolean;
}

// Deterministic REPLAY key. Distinct namespace from the source completion
// event key (`quote_follow_up_completed:...`) so the original stored
// decisions cannot be returned as the replay outcome.
export function backfillReplayIdempotencyKey(
  sourceEventId: string,
  destinationCampaignId: string,
  destinationCampaignVersion: number | null | undefined,
): string {
  const v = Number.isFinite(Number(destinationCampaignVersion))
    ? Number(destinationCampaignVersion)
    : 0;
  return `campaign_transition_replay:${sourceEventId}:${destinationCampaignId}:v${v}`;
}

// Pure eligibility gate. Returns the exact bucket the dry-run reports and the
// live runner writes into audit metadata.
export function evaluateBackfill(i: BackfillEligibilityInput): { outcome: BackfillOutcome } {
  if (!i.hasEventId || !i.hasCustomerIdentity) return { outcome: "invalid_event" };
  if (i.alreadyReplayed) return { outcome: "already_replayed" };
  if (i.alreadyEnrolledInDestination) return { outcome: "already_enrolled" };
  if (i.hasBooking) return { outcome: "booked" };
  if (i.optedOut) return { outcome: "opted_out" };
  if (i.suppressed) return { outcome: "suppressed" };
  if (i.humanTakeover) return { outcome: "human_takeover" };
  if (i.supersededByNewerQuoteLifecycle) return { outcome: "superseded" };
  if (!i.marketingConsentGranted) return { outcome: "no_consent" };
  return { outcome: "eligible" };
}

// Preserved audit envelope for the replay call to campaign-event. These are
// the fields the requirements enumerate — original event id, source
// enrollment, source campaign + version, quote id, customer id, first-touch
// attribution, service info, and the original completion timestamp — plus a
// `replay` block that records the replay relationship.
export interface SourceCompletionEvent {
  id: string;
  customer_id: string | null;
  email: string | null;
  phone: string | null;
  processed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export function buildReplayMetadata(
  src: SourceCompletionEvent,
  destinationCampaignId: string,
  destinationCampaignVersion: number | null | undefined,
): Record<string, unknown> {
  const m = (src.metadata ?? {}) as Record<string, unknown>;
  return {
    // Preserve first-touch attribution + journey references verbatim.
    quote_id: m.quote_id ?? null,
    customer_id: src.customer_id,
    source_enrollment_id: m.source_enrollment_id ?? null,
    source_campaign_id: m.source_campaign_id ?? null,
    source_campaign_version: m.source_campaign_version ?? null,
    original_event_id: src.id,
    original_completed_at: src.processed_at ?? m.completed_at ?? null,
    final_send_at: m.final_send_at ?? null,
    attribution: m.attribution ?? null,
    utm_params_json: m.utm_params_json ?? null,
    service_types: Array.isArray(m.service_types) ? m.service_types : [],
    pricing_rule_version: m.pricing_rule_version ?? null,
    // Replay relationship — recorded in event metadata so the audit trail
    // links the destination event back to the historical completion event.
    replay: {
      via: "campaign_transition_replay",
      destination_campaign_id: destinationCampaignId,
      destination_campaign_version:
        Number.isFinite(Number(destinationCampaignVersion))
          ? Number(destinationCampaignVersion)
          : null,
      replayed_at: new Date().toISOString(),
    },
  };
}