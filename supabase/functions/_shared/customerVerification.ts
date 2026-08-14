// Shared helpers for the CallRail-delivered customer verification / portal flow.
// Keep all crypto + DB access server-side. Never expose these values to browsers.

// deno-lint-ignore no-explicit-any
type SB = any;

const enc = new TextEncoder();

/** SHA-256 hex hash. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/** Cryptographically-random 6-digit numeric OTP. */
export function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (arr[0] % 1_000_000).toString().padStart(6, "0");
}

/** 256-bit opaque random token, base64url-encoded. */
export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface VerificationConfig {
  otp_ttl_seconds: number;
  per_phone_cooldown_seconds: number;
  per_phone_max_per_hour: number;
  per_ip_max_per_hour: number;
  max_attempts: number;
  session_inactivity_seconds: number;
  session_absolute_seconds: number;
  booking_link_ttl_hours: number;
}

const DEFAULT_CONFIG: VerificationConfig = {
  otp_ttl_seconds: 600,
  per_phone_cooldown_seconds: 60,
  per_phone_max_per_hour: 5,
  per_ip_max_per_hour: 10,
  max_attempts: 5,
  session_inactivity_seconds: 1800,
  session_absolute_seconds: 43200,
  booking_link_ttl_hours: 72,
};

export async function loadVerificationConfig(
  supabase: SB,
): Promise<VerificationConfig> {
  try {
    const { data } = await supabase
      .from("customer_verification_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    if (!data) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Look up an active portal session by raw token; refresh last_seen_at. */
export async function getActivePortalSession(supabase: SB, rawToken: string) {
  if (!rawToken || rawToken.length < 20) return null;
  const hash = await sha256Hex(rawToken);
  const { data, error } = await supabase
    .from("customer_portal_sessions")
    .select(
      "id, organization_id, customer_account_id, last_seen_at, absolute_expires_at, revoked_at",
    )
    .eq("session_token_hash", hash)
    .maybeSingle();
  if (error || !data || data.revoked_at) return null;
  if (
    typeof data.organization_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(data.organization_id)
  ) return null;
  if (new Date(data.absolute_expires_at).getTime() < Date.now()) return null;
  const cfg = await loadVerificationConfig(supabase);
  const idleCutoff = Date.now() - cfg.session_inactivity_seconds * 1000;
  if (new Date(data.last_seen_at).getTime() < idleCutoff) return null;
  const { error: refreshError } = await supabase.from(
    "customer_portal_sessions",
  )
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("organization_id", data.organization_id);
  if (refreshError) return null;
  return data as {
    id: string;
    organization_id: string;
    customer_account_id: string;
  };
}

export function extractPortalToken(req: Request): string | null {
  const header = req.headers.get("x-portal-session");
  if (header && header.length > 20) return header;
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)bl_portal=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function portalCookie(token: string, maxAgeSeconds: number): string {
  return `bl_portal=${
    encodeURIComponent(token)
  }; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearPortalCookie(): string {
  return `bl_portal=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
