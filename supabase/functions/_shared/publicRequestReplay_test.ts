import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideBookingReservationExecution,
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

Deno.test("durable reservation replay creates one provider job and visit", () => {
  const fingerprint = "fingerprint-1";
  let durableResult: Record<string, unknown> | null = null;
  let jobCreates = 0;
  let visitCreates = 0;
  const attempt = () => {
    const decision = decideBookingReservationExecution(
      durableResult
        ? { idempotent: true, group_id: "group-1", result: durableResult }
        : { idempotent: false, ok: true, group_id: "group-1" },
      fingerprint,
      { serviceRoleCaller: true },
    );
    if (decision.action === "replay") return decision.result;
    assertEquals(decision.action, "execute");
    jobCreates += 1;
    visitCreates += 1;
    durableResult = {
      success: true,
      jobberJobId: "job-1",
      jobberVisitId: "visit-1",
      _requestFingerprint: fingerprint,
    };
    return publicReplayResult(durableResult);
  };

  assertEquals(attempt(), attempt());
  assertEquals(jobCreates, 1);
  assertEquals(visitCreates, 1);
});

Deno.test("idempotent reservation without a result never reaches the provider", () => {
  const decision = decideBookingReservationExecution(
    {
      idempotent: true,
      group_id: "group-1",
      status: "executing",
      result: null,
    },
    "fingerprint-1",
    { serviceRoleCaller: true, preReservedGroupId: null },
  );
  assertEquals(decision, { action: "in_progress_or_uncertain" });
});
