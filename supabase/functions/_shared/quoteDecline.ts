// Pure state classification for the destructive quote-decline transition.
// Keep this separate from the edge handler so terminal-state and expiry
// behavior can be verified without a database or provider.

export type QuoteDeclineDisposition =
  | "eligible"
  | "already_declined"
  | "already_converted"
  | "expired"
  | "state_conflict";

export interface QuoteDeclineState {
  status?: string | null;
  converted_booking_id?: string | null;
  expires_at?: string | null;
}

const DECLINEABLE_STATUSES = new Set(["pending", "viewed", "saved", "emailed"]);

export function canDeclineQuote(
  privileged: boolean,
  resumeCapabilityVerified: boolean,
): boolean {
  return privileged || resumeCapabilityVerified;
}

export function quoteLifecycleAllowsCampaignDelivery(
  quote: QuoteDeclineState,
  sourceEventName: string,
): boolean {
  if (quote.status === "converted" || quote.converted_booking_id) {
    return sourceEventName === "booking_completed";
  }
  if (quote.status === "declined") return sourceEventName === "quote_declined";
  if (quote.status === "expired") return false;
  return !!quote.status && DECLINEABLE_STATUSES.has(quote.status);
}

export function classifyQuoteDecline(
  quote: QuoteDeclineState,
  nowMs = Date.now(),
): QuoteDeclineDisposition {
  if (quote.status === "converted" || quote.converted_booking_id) {
    return "already_converted";
  }
  if (quote.status === "declined") return "already_declined";
  if (quote.status === "expired") return "expired";
  if (quote.expires_at) {
    const expiresAtMs = Date.parse(quote.expires_at);
    if (!Number.isFinite(expiresAtMs)) return "state_conflict";
    if (expiresAtMs <= nowMs) return "expired";
  }
  if (!quote.status || !DECLINEABLE_STATUSES.has(quote.status)) {
    return "state_conflict";
  }
  return "eligible";
}
