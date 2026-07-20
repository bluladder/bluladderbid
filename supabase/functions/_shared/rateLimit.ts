// Rate limiting primitives for edge functions.
//
// Two flavors are exported:
//
// 1. `rateLimit(req, opts)` — synchronous, in-memory, per-instance. Cheap and
//    zero-latency, but resets on cold start and does NOT share state across
//    concurrent Deno instances. Use as a first-line burst brake.
//
// 2. `sharedRateLimit(req, opts)` — async, backed by the `rate_limit_buckets`
//    table via the `check_and_increment_rate_limit` RPC. Consistent across all
//    instances and cold starts. Use for sensitive public endpoints (identity,
//    OTP, webhooks, PII lookup, admin actions).
//
// Both use the same request-derived caller identity (IP) unless `identifier`
// is provided explicitly (e.g. phone number for OTP flows).

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store (will reset when function cold starts, which is acceptable)
const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitOptions {
  limit: number;      // Max requests allowed
  windowMs: number;   // Time window in milliseconds
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export function rateLimit(
  req: Request,
  options: RateLimitOptions = { limit: 10, windowMs: 60000 }
): RateLimitResult {
  const { limit, windowMs } = options;
  const now = Date.now();
  
  // Get client IP from headers (Supabase Edge Functions provide this)
  const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    || req.headers.get("x-real-ip") 
    || "unknown";
  
  // Clean up expired entries periodically
  if (Math.random() < 0.1) { // 10% chance to clean up on each request
    for (const [key, entry] of rateLimitStore.entries()) {
      if (now > entry.resetTime) {
        rateLimitStore.delete(key);
      }
    }
  }
  
  const entry = rateLimitStore.get(clientIP);
  
  if (!entry || now > entry.resetTime) {
    // Create new entry
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitStore.set(clientIP, newEntry);
    
    return {
      allowed: true,
      remaining: limit - 1,
      resetTime: newEntry.resetTime,
    };
  }
  
  // Increment existing entry
  entry.count++;
  
  if (entry.count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.resetTime,
    };
  }
  
  return {
    allowed: true,
    remaining: limit - entry.count,
    resetTime: entry.resetTime,
  };
}

// ---------------------------------------------------------------------------
// Shared / DB-backed limiter
// ---------------------------------------------------------------------------

export interface SharedRateLimitOptions {
  /** Logical bucket name (function/endpoint identifier). Required. */
  key: string;
  /** Max requests allowed per window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /**
   * Optional caller identity override. Defaults to client IP derived from
   * `x-forwarded-for` / `x-real-ip`. Pass a phone number / email hash / etc.
   * when the natural identity is not the IP.
   */
  identifier?: string;
}

export interface SharedRateLimitResult {
  allowed: boolean;
  count: number;
  resetAt: number; // epoch ms
  /** True when the backing store failed and we fell open. */
  degraded: boolean;
}

function callerIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// Lazily created service-role client so the shared limiter works even when the
// caller edge function only has an anon client on hand.
let cachedClient: unknown = null;
async function getServiceClient() {
  if (cachedClient) return cachedClient;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;
  const mod = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
  cachedClient = mod.createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Atomically increments a shared bucket and returns whether the request is
 * allowed. Fails open (allowed=true, degraded=true) if the DB is unreachable;
 * pair with the in-memory `rateLimit()` for defense in depth.
 */
export async function sharedRateLimit(
  req: Request,
  options: SharedRateLimitOptions,
): Promise<SharedRateLimitResult> {
  const { key, limit, windowMs } = options;
  const identifier = options.identifier?.trim() || callerIp(req);
  const bucketKey = `${key}:${identifier}`;
  try {
    const client = await getServiceClient();
    if (!client) {
      return { allowed: true, count: 0, resetAt: Date.now() + windowMs, degraded: true };
    }
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (client as any).rpc("check_and_increment_rate_limit", {
      _key: bucketKey,
      _limit: limit,
      _window_ms: windowMs,
    });
    if (error || !data || !Array.isArray(data) || data.length === 0) {
      console.warn("[sharedRateLimit] degraded", { key: bucketKey, error: error?.message });
      return { allowed: true, count: 0, resetAt: Date.now() + windowMs, degraded: true };
    }
    const row = data[0] as { allowed: boolean; current_count: number; reset_at: string };
    return {
      allowed: row.allowed,
      count: row.current_count,
      resetAt: new Date(row.reset_at).getTime(),
      degraded: false,
    };
  } catch (err) {
    console.warn("[sharedRateLimit] threw", { key: bucketKey, err: (err as Error).message });
    return { allowed: true, count: 0, resetAt: Date.now() + windowMs, degraded: true };
  }
}

/**
 * Convenience: 429 JSON response with a Retry-After header derived from the
 * limiter result. Callers still supply their own `corsHeaders`.
 */
export function rateLimitedResponse(
  result: { resetAt?: number; resetTime?: number },
  corsHeaders: Record<string, string>,
  message = "Too many requests. Please try again shortly.",
): Response {
  const resetAt = result.resetAt ?? result.resetTime ?? Date.now() + 60_000;
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
    },
  });
}
