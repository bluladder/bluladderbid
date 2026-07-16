import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { sha256Hex, generateOtp, generateSessionToken, extractPortalToken, portalCookie, clearPortalCookie } from "./customerVerification.ts";

Deno.test("sha256Hex is deterministic and 64 hex chars", async () => {
  const a = await sha256Hex("hello");
  const b = await sha256Hex("hello");
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assert(/^[0-9a-f]+$/.test(a));
});

Deno.test("generateOtp always returns 6 digits", () => {
  for (let i = 0; i < 200; i++) {
    const otp = generateOtp();
    assert(/^\d{6}$/.test(otp), `bad OTP: ${otp}`);
  }
});

Deno.test("generateSessionToken produces distinct high-entropy tokens", () => {
  const set = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const t = generateSessionToken();
    assert(t.length >= 40);
    set.add(t);
  }
  assertEquals(set.size, 100);
});

Deno.test("extractPortalToken reads header and cookie", () => {
  const long = "a".repeat(40);
  const req1 = new Request("http://x", { headers: { "x-portal-session": long } });
  assertEquals(extractPortalToken(req1), long);

  const req2 = new Request("http://x", { headers: { cookie: `foo=1; bl_portal=${long}; bar=2` } });
  assertEquals(extractPortalToken(req2), long);

  const req3 = new Request("http://x");
  assertEquals(extractPortalToken(req3), null);
});

Deno.test("portalCookie contains HttpOnly + Secure + Path + Max-Age", () => {
  const c = portalCookie("xyz", 60);
  assert(c.includes("HttpOnly"));
  assert(c.includes("Secure"));
  assert(c.includes("Path=/"));
  assert(c.includes("Max-Age=60"));
  const cleared = clearPortalCookie();
  assert(cleared.includes("Max-Age=0"));
  assertNotEquals(c, cleared);
});