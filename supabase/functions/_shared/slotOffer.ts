// ============================================================================
// slotOffer.ts — pure, dependency-free helpers for availability-offer identity
// (Defect 2). Kept separate from aiTools.ts so the offer signature and slot-id
// binding are unit-testable without importing Supabase/network deps.
// ============================================================================

// How long an availability offer stays selectable before it must be refreshed.
export const OFFER_TTL_MS = 15 * 60 * 1000;
// Consecutive failed slot selections tolerated before we hand off to a human.
export const MAX_SLOT_FAILURES_BEFORE_ESCALATION = 2;

/**
 * A stable signature of the priced job. If any of these change between the
 * moment slots were offered and the moment the customer confirms, the offer is
 * invalid and must not be booked against a stale price/duration.
 */
export function computeQuoteSignature(quote: any): string {
  const lineItems = (quote?.jobberLineItems ?? quote?.lineItems ?? []).map((li: any) => ({
    n: li.name ?? li.label ?? "",
    p: Number(li.unitPrice ?? li.amount ?? 0),
  }));
  return JSON.stringify({
    total: quote?.total ?? null,
    rule: quote?.ruleVersion ?? null,
    engine: quote?.engineVersion ?? null,
    dur: quote?.estimatedDurationMinutes ?? null,
    items: lineItems,
  });
}

/** Opaque, per-offer slot id. Uniqueness comes from the offer version. */
export function buildOfferSlotId(offerVersion: string, index: number): string {
  return `slot_${offerVersion}_${index + 1}`;
}
