import type { LaunchDiagnosticRecord } from "./launchDiagnostics";

const organizationId = "00000000-0000-4000-8000-0000000000df";

export const launchDiagnosticFixtures: LaunchDiagnosticRecord[] = [
  ["booking_outcome", "booking_provider_timeout"],
  ["manual_intervention", "intervention_record_failed"],
  ["bid_delivery", "provider_result_uncertain"],
  ["quote_response", "stale_quote_transition"],
  ["communication", "delivery_unknown"],
  ["follow_up", "claim_expired"],
  ["voice_call", "repository_adapter_disabled"],
  ["launch_incident", "hosted_evidence_missing"],
].map(([kind, reasonCode], index) => ({
  id: `fixture-${index + 1}`,
  organizationId,
  kind: kind as LaunchDiagnosticRecord["kind"],
  occurredAt: `2026-07-29T12:0${index}:00.000Z`,
  updatedAt: `2026-07-29T12:0${index}:00.000Z`,
  correlationId: `fixture-correlation-${index + 1}`,
  reasonCode,
  retryable: index === 0 || index === 4 || index === 5,
  retryState: index === 2 ? "uncertain" : index === 5 ? "claimed" : "none",
  resolutionState: "unresolved",
  evidenceTier: "repository_fixture",
  customerRef: index < 6 ? `customer-ref-${index + 1}` : null,
  jobRef: null,
  quoteRef: index === 2 || index === 3 ? `quote-ref-${index + 1}` : null,
  bookingRef: index === 0 ? "booking-ref-1" : null,
  callRef: index === 6 ? "call-ref-7" : null,
  customerWasToldInaccurateState: false,
  actionRequired: "Inspect the referenced workflow before retrying.",
}));

