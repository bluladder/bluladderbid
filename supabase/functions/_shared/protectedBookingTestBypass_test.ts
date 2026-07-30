import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateProtectedBookingTestBypass,
  type ProtectedBookingTestIdentity,
  type ProtectedBookingTestRun,
} from "./protectedBookingTestBypass.ts";

const run: ProtectedBookingTestRun = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  phase: "execute",
  status: "running",
  conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  slot_id: "slot-1",
  idempotency_key: "booking-key",
  auth_key: "authorization-key",
};
const identity: ProtectedBookingTestIdentity = {
  email: "protected@example.invalid",
  protected: true,
  active: true,
  live_jobber_test_enabled: true,
  authorized_conversation_id: run.conversation_id,
  authorized_slot_id: run.slot_id,
  authorized_idempotency_key: run.auth_key,
  authorization_expires_at: "2026-07-30T00:00:00.000Z",
  authorization_consumed_at: "2026-07-29T23:00:00.000Z",
};
const base = {
  callerIsServiceRole: true,
  requestedRunId: run.id,
  bookingEmail: identity.email,
  bookingIdempotencyKey: run.idempotency_key ?? "",
  run,
  identity,
  now: new Date("2026-07-29T23:30:00.000Z"),
};

Deno.test("only the consumed identity-scoped system-test run bypasses a public pause", () => {
  assertEquals(evaluateProtectedBookingTestBypass(base), {
    authorized: true,
    reason: "authorized",
  });
});

Deno.test("protected bypass rejects anonymous, stale, unconsumed, and mismatched requests", () => {
  const cases = [
    { callerIsServiceRole: false },
    { requestedRunId: "not-a-run" },
    { bookingIdempotencyKey: "other-key" },
    {
      identity: {
        ...identity,
        authorization_consumed_at: null,
      },
    },
    {
      identity: {
        ...identity,
        authorization_expires_at: "2026-07-29T23:29:00.000Z",
      },
    },
    {
      identity: {
        ...identity,
        authorized_conversation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    },
  ];
  for (const patch of cases) {
    assertEquals(
      evaluateProtectedBookingTestBypass({ ...base, ...patch }).authorized,
      false,
    );
  }
});
