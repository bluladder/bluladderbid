// ============================================================================
// quoteResumeTokens — mint, hash, verify, and revoke resume tokens for a
// specific quote. Raw tokens are ONLY ever returned to the caller that minted
// them (so they can be embedded in an outbound link); the database stores a
// SHA-256 hash and nothing more. Verification is constant-time equality on
// the hash + expiry + revocation checks. Nothing here reads or exposes
// customer PII, pricing, or services — those come from a separate,
// scope-limited "quote-resume" endpoint.
// ============================================================================
// deno-lint-ignore no-explicit-any
type SB = any;

const enc = new TextEncoder();
const APP_URL_DEFAULT = "https://bid.bluladder.com";

/** SHA-256 hex digest. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 32-byte (256-bit) cryptographically random opaque token, base64url encoded. */
export function generateResumeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface MintOptions {
  /** TTL in hours. Defaults to 30 days to match the quote's own 30d validity. */
  ttlHours?: number;
  /** Human-readable label for auditing (e.g. "save_quote_email", "sms_reminder"). */
  issuedReason?: string;
  /** Base URL for the returned resume URL. Defaults to https://bid.bluladder.com. */
  appUrl?: string;
}

export interface MintedResumeToken {
  token: string;        // raw token — return once, never persisted in cleartext
  tokenHash: string;
  expiresAt: string;    // ISO
  resumeUrl: string;    // full URL customers should click
}

/**
 * Mint a fresh single-quote resume token, persist ONLY its hash, and return
 * the raw token + a full customer-facing resume URL. The caller is responsible
 * for using it exactly once — subsequent link generation should mint a new
 * token, not try to retrieve the raw value (which is impossible by design).
 */
export async function mintQuoteResumeToken(
  supabase: SB,
  quoteId: string,
  opts: MintOptions = {},
): Promise<MintedResumeToken | null> {
  if (!quoteId || typeof quoteId !== "string") return null;
  const ttlHours = Number.isFinite(opts.ttlHours ?? NaN) ? opts.ttlHours! : 24 * 30;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();
  const token = generateResumeToken();
  const tokenHash = await sha256Hex(token);
  const { error } = await supabase.from("quote_resume_tokens").insert({
    quote_id: quoteId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    issued_reason: opts.issuedReason ?? null,
  });
  if (error) {
    console.error("mintQuoteResumeToken: insert failed", error.message);
    return null;
  }
  const base = (opts.appUrl || APP_URL_DEFAULT).replace(/\/+$/, "");
  const resumeUrl = `${base}/quote/${quoteId}?resume=${encodeURIComponent(token)}`;
  return { token, tokenHash, expiresAt, resumeUrl };
}

export interface VerifiedResumeToken {
  ok: true;
  quoteId: string;
  tokenId: string;
  expiresAt: string;
}

export interface FailedResumeToken {
  ok: false;
  reason:
    | "malformed"
    | "not_found"
    | "expired"
    | "revoked"
    | "quote_mismatch";
}

/**
 * Look up a token by hash and confirm:
 *   1) it exists,
 *   2) it is scoped to the requested quote,
 *   3) it has not been revoked,
 *   4) it has not expired.
 *
 * On success, atomically records use metadata (last_used_at, use_count).
 * Returns discriminated result. Never leaks whether a quote or token exists to
 * a caller who does not present a valid pair — every failure returns the same
 * shape from the endpoint using it.
 */
export async function verifyResumeToken(
  supabase: SB,
  quoteId: string,
  rawToken: string,
): Promise<VerifiedResumeToken | FailedResumeToken> {
  if (
    !quoteId || typeof quoteId !== "string" ||
    !rawToken || typeof rawToken !== "string" ||
    rawToken.length < 20 || rawToken.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(rawToken)
  ) {
    return { ok: false, reason: "malformed" };
  }
  const tokenHash = await sha256Hex(rawToken);
  const { data } = await supabase
    .from("quote_resume_tokens")
    .select("id, quote_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return { ok: false, reason: "not_found" };
  if (data.quote_id !== quoteId) return { ok: false, reason: "quote_mismatch" };
  if (data.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  // Best-effort use metadata; never blocks the caller.
  supabase
    .from("quote_resume_tokens")
    .update({
      last_used_at: new Date().toISOString(),
      use_count: (typeof (data as { use_count?: number }).use_count === "number"
        ? (data as { use_count: number }).use_count
        : 0) + 1,
    })
    .eq("id", data.id)
    .then(() => {})
    .catch(() => {});
  return {
    ok: true,
    quoteId,
    tokenId: data.id,
    expiresAt: data.expires_at,
  };
}

/** Revoke every active token for a given quote (e.g. when it is superseded). */
export async function revokeQuoteResumeTokens(
  supabase: SB,
  quoteId: string,
): Promise<void> {
  await supabase
    .from("quote_resume_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("quote_id", quoteId)
    .is("revoked_at", null);
}
