import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fingerprintPublicRequest,
  publicReplayResult,
  requestFingerprintMatches,
} from "./publicRequestReplay.ts";

Deno.test("public request fingerprint is stable and request-bound", async () => {
  const first = await fingerprintPublicRequest({
    email: "customer@example.com",
    address: "123 Main St, Aubrey, TX 76227",
  });
  const replay = await fingerprintPublicRequest({
    email: "customer@example.com",
    address: "123 Main St, Aubrey, TX 76227",
  });
  const changed = await fingerprintPublicRequest({
    email: "customer@example.com",
    address: "125 Main St, Aubrey, TX 76227",
  });
  assertEquals(first, replay);
  assertEquals(first === changed, false);
});

Deno.test("internal replay fingerprint is matched and never returned publicly", () => {
  const stored = {
    success: true,
    bookingId: "booking-1",
    _requestFingerprint: "fingerprint-1",
  };
  assertEquals(requestFingerprintMatches(stored, "fingerprint-1"), true);
  assertEquals(requestFingerprintMatches(stored, "other"), false);
  assertEquals(publicReplayResult(stored), {
    success: true,
    bookingId: "booking-1",
  });
});
