// ============================================================================
// resumeLink — mint a fresh, opaque quote-resume URL at SEND time. Never
// persist the raw token anywhere except the outbound message body that is
// about to leave the system: no queue rows, no campaign snapshots, no logs.
// Callers that want to reuse the mint across a single send call can pass a
// per-request cache map to avoid double-minting.
// ============================================================================
import { mintQuoteResumeToken } from "./quoteResumeTokens.ts";
import { getAppUrl } from "./appUrl.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

/**
 * Mint a fresh secure resume URL for a quote. If minting fails, returns the
 * app root URL — NEVER the bare /quote/<uuid>, which would leak PII when
 * QuoteView refuses to render unauthenticated bare requests.
 */
export async function mintResumeUrl(
  supabase: SB,
  quoteId: string,
  opts: { reason: string; ttlHours?: number } = { reason: "outbound" },
): Promise<string> {
  if (!quoteId) return getAppUrl();
  const minted = await mintQuoteResumeToken(supabase, quoteId, {
    ttlHours: opts.ttlHours ?? 24 * 30,
    issuedReason: opts.reason,
    appUrl: getAppUrl(),
  });
  return minted?.resumeUrl ?? getAppUrl();
}