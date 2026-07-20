// ============================================================================
// appUrl — single source of truth for customer-facing application URLs.
// Production must resolve to the canonical domain https://bid.bluladder.com.
// Preview / dev environments may set PUBLIC_APP_URL explicitly. In production
// (DENO_DEPLOYMENT_ID present) we fail-closed if the value is not set to a
// non-lovable-domain URL, rather than silently linking customers to a
// preview host.
// ============================================================================

export const CANONICAL_PRODUCTION_APP_URL = "https://bid.bluladder.com";

function isProduction(): boolean {
  return !!Deno.env.get("DENO_DEPLOYMENT_ID") || Deno.env.get("APP_ENV") === "production";
}

function normalize(u: string): string {
  return u.replace(/\/+$/, "");
}

/**
 * Resolve the canonical customer-facing app URL.
 * Precedence:
 *   1. PUBLIC_APP_URL (explicit override for preview/dev)
 *   2. APP_URL (legacy alias, kept temporarily for compatibility)
 *   3. In production: hard fallback to CANONICAL_PRODUCTION_APP_URL
 *   4. In dev/test only: local preview
 */
export function getAppUrl(): string {
  const explicit = Deno.env.get("PUBLIC_APP_URL") || Deno.env.get("APP_URL") || "";
  if (explicit) {
    if (isProduction() && /lovable\.(app|dev)/i.test(explicit)) {
      // Never silently ship a lovable-domain URL to customers in production.
      return CANONICAL_PRODUCTION_APP_URL;
    }
    return normalize(explicit);
  }
  if (isProduction()) return CANONICAL_PRODUCTION_APP_URL;
  return "http://localhost:8080";
}

/** Build a URL for a quote-view page. Never embeds PII. */
export function buildQuoteUrl(quoteId: string): string {
  return `${getAppUrl()}/quote/${quoteId}`;
}
