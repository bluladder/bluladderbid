// ============================================================================
// Secure email reply tokens.
//
// Outbound emails include a signed thread token in the Reply-To local-part
// (e.g. reply+<token>@notify.bluladder.com). Inbound replies are matched by
// the token stored in email_reply_tokens rather than by subject text.
//
// The token is HMAC-SHA256(secret, id) where id is a random opaque prefix.
// The signature is verified before any DB lookup so an attacker cannot
// enumerate conversation IDs.
// ============================================================================

const SECRET_ENV = "EMAIL_REPLY_TOKEN_SECRET";

function b64url(bytes: Uint8Array): string {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function hmac(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return b64url(new Uint8Array(sig)).slice(0, 24);
}

/**
 * Build a signed token string. Format: `<id>.<sig>` where id is 16 random
 * bytes b64url-encoded and sig is HMAC(secret, id) truncated.
 * The random id is what gets stored as the primary key in email_reply_tokens.
 */
export async function issueReplyToken(secret?: string): Promise<{ token: string; id: string }> {
  const s = secret ?? Deno.env.get(SECRET_ENV) ?? "";
  if (!s) throw new Error("EMAIL_REPLY_TOKEN_SECRET not configured");
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  const id = b64url(rand);
  const sig = await hmac(s, id);
  return { token: `${id}.${sig}`, id };
}

/**
 * Parse an incoming Reply-To local-part like `reply+<token>@...` and return
 * the id iff signature verifies. Returns null on any tampering / bad format.
 */
export async function verifyReplyToken(token: string, secret?: string): Promise<string | null> {
  const s = secret ?? Deno.env.get(SECRET_ENV) ?? "";
  if (!s || !token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [id, sig] = parts;
  if (!id || !sig) return null;
  const expected = await hmac(s, id);
  // constant-time-ish compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? id : null;
}

/**
 * Extract the token from an inbound recipient address of the form
 * `reply+<token>@domain` or from a plain address (returns null).
 */
export function tokenFromAddress(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = /reply\+([^@]+)@/i.exec(addr);
  return m ? m[1] : null;
}