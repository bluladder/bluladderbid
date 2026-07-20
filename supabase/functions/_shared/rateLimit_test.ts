// Unit tests for the shared/DB-backed rate limiter.
//
// These tests exercise the fail-open behavior when the service role env is
// absent (the real RPC path is exercised end-to-end from the calling
// functions and covered by their own integration tests).
import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { rateLimit, sharedRateLimit, rateLimitedResponse } from "./rateLimit.ts";

function fakeReq(ip = "10.0.0.1"): Request {
  return new Request("https://example.com/x", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

Deno.test("in-memory rateLimit blocks after limit is exceeded", () => {
  const req = fakeReq("192.0.2.10");
  const opts = { limit: 3, windowMs: 60_000 };
  const r1 = rateLimit(req, opts);
  const r2 = rateLimit(req, opts);
  const r3 = rateLimit(req, opts);
  const r4 = rateLimit(req, opts);
  assertEquals(r1.allowed, true);
  assertEquals(r2.allowed, true);
  assertEquals(r3.allowed, true);
  assertEquals(r4.allowed, false);
});

Deno.test("sharedRateLimit fails open when service env is missing", async () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.delete("SUPABASE_URL");
  Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  try {
    const res = await sharedRateLimit(fakeReq(), {
      key: "unit-test",
      limit: 1,
      windowMs: 1_000,
    });
    assertEquals(res.allowed, true);
    assertEquals(res.degraded, true);
  } finally {
    if (url) Deno.env.set("SUPABASE_URL", url);
    if (key) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", key);
  }
});

Deno.test("rateLimitedResponse emits 429 with a Retry-After header", () => {
  const res = rateLimitedResponse(
    { resetAt: Date.now() + 30_000 },
    { "Access-Control-Allow-Origin": "*" },
  );
  assertEquals(res.status, 429);
  const retry = Number(res.headers.get("Retry-After"));
  // Retry-After should be a positive integer number of seconds.
  if (!(retry > 0 && retry <= 31)) {
    throw new Error(`unexpected Retry-After: ${retry}`);
  }
});