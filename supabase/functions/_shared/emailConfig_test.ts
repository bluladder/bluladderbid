import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { classifyResendFailure, isFromDomainVerified, type DomainValidation } from "./emailConfig.ts";

Deno.test("401 unverified domain → sender_not_verified, not retryable, reached provider", () => {
  const f = classifyResendFailure(403, "The bluladder.com domain is not verified.");
  assertEquals(f.category, "sender_not_verified");
  assertEquals(f.retryable, false);
  assertEquals(f.reachedProvider, true);
});

Deno.test("plain 'not verified' body maps to sender_not_verified", () => {
  const f = classifyResendFailure(400, "You must verify a domain before sending.");
  assertEquals(f.category, "sender_not_verified");
});

Deno.test("sandbox restriction detected", () => {
  const f = classifyResendFailure(403, "You can only send testing emails to your own address. Use onboarding@resend.dev");
  assertEquals(f.category, "sandbox_restricted");
});

Deno.test("429 → rate_limited and retryable", () => {
  const f = classifyResendFailure(429, "Too many requests");
  assertEquals(f.category, "rate_limited");
  assertEquals(f.retryable, true);
});

Deno.test("422 invalid recipient", () => {
  const f = classifyResendFailure(422, "Invalid `to` field");
  assertEquals(f.category, "invalid_recipient");
});

Deno.test("isFromDomainVerified true only for verified match", () => {
  const v: DomainValidation = { ok: true, apiKeyPresent: true, reachedProvider: true, httpStatus: 200, error: null,
    domains: [{ name: "mail.bluladder.com", status: "verified" }, { name: "bluladder.com", status: "pending" }] };
  assertEquals(isFromDomainVerified(v, "mail.bluladder.com"), true);
  assertEquals(isFromDomainVerified(v, "bluladder.com"), false);
  assertEquals(isFromDomainVerified(v, "other.com"), false);
});
