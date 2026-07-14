import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVED_TEST_EMAIL,
  buildAuthKey,
  buildIdempotencyKey,
  evaluateAuthGate,
  initialSteps,
  markStep,
  pickSlotAtLeastDaysAhead,
  safeStageLabel,
  type OfferedSlot,
} from "./testRunLogic.ts";

Deno.test("initialSteps returns all step groups as pending", () => {
  const s = initialSteps();
  const count = s.length;
  const allPending = s.every((x) => x.status === "pending");
  assertEquals(count > 30, true);
  assertEquals(allPending, true);
});

Deno.test("markStep updates only the target key", () => {
  const s = initialSteps();
  const after = markStep(s, "quote_firm", { status: "passed" });
  const target = after.find((x) => x.key === "quote_firm")!;
  assertEquals(target.status, "passed");
  const others = after.filter((x) => x.key !== "quote_firm").every((x) => x.status === "pending");
  assertEquals(others, true);
});

Deno.test("buildAuthKey and buildIdempotencyKey have the required shapes", () => {
  assertEquals(buildAuthKey("c1", "s2"), "chat|c1|s2");
  assertEquals(buildIdempotencyKey("c1", "2026-08-01T15:00:00Z"), "chat|c1|2026-08-01T15:00:00Z");
});

Deno.test("pickSlotAtLeastDaysAhead picks the earliest slot ≥ N days out", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const slots: OfferedSlot[] = [
    { slotId: "a", startTime: "2026-08-05T15:00:00Z" }, // 4 days
    { slotId: "b", startTime: "2026-08-09T15:00:00Z" }, // 8 days
    { slotId: "c", startTime: "2026-08-15T15:00:00Z" }, // 14 days
  ];
  const picked = pickSlotAtLeastDaysAhead(slots, 7, now);
  assertEquals(picked?.slotId, "b");
});

Deno.test("pickSlotAtLeastDaysAhead returns null when nothing qualifies", () => {
  const now = new Date("2026-08-01T00:00:00Z");
  const slots: OfferedSlot[] = [{ slotId: "a", startTime: "2026-08-05T15:00:00Z" }];
  assertEquals(pickSlotAtLeastDaysAhead(slots, 7, now), null);
});

Deno.test("evaluateAuthGate — not enabled → not_authorized", () => {
  const r = evaluateAuthGate(
    { live_jobber_test_enabled: false } as any,
    { conversationId: "c", slotId: "s", authKey: "chat|c|s" },
  );
  assertEquals(r, { ok: false, reason: "not_authorized" });
});

Deno.test("evaluateAuthGate — expired", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const r = evaluateAuthGate(
    {
      live_jobber_test_enabled: true,
      authorized_conversation_id: "c",
      authorized_slot_id: "s",
      authorized_idempotency_key: "chat|c|s",
      authorization_expires_at: "2026-08-01T11:00:00Z",
    },
    { conversationId: "c", slotId: "s", authKey: "chat|c|s" },
    now,
  );
  assertEquals(r.ok, false);
  assertEquals(r.reason, "expired");
});

Deno.test("evaluateAuthGate — already consumed", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const r = evaluateAuthGate(
    {
      live_jobber_test_enabled: true,
      authorized_conversation_id: "c",
      authorized_slot_id: "s",
      authorized_idempotency_key: "chat|c|s",
      authorization_expires_at: "2026-08-01T13:00:00Z",
      authorization_consumed_at: "2026-08-01T12:30:00Z",
    },
    { conversationId: "c", slotId: "s", authKey: "chat|c|s" },
    now,
  );
  assertEquals(r, { ok: false, reason: "already_consumed" });
});

Deno.test("evaluateAuthGate — mismatch on conversation/slot/key", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const base = {
    live_jobber_test_enabled: true,
    authorized_conversation_id: "c",
    authorized_slot_id: "s",
    authorized_idempotency_key: "chat|c|s",
    authorization_expires_at: "2026-08-01T13:00:00Z",
  };
  for (const patch of [
    { authorized_conversation_id: "other" },
    { authorized_slot_id: "other" },
    { authorized_idempotency_key: "chat|c|other" },
  ]) {
    const r = evaluateAuthGate({ ...base, ...patch }, { conversationId: "c", slotId: "s", authKey: "chat|c|s" }, now);
    assertEquals(r, { ok: false, reason: "mismatch" });
  }
});

Deno.test("evaluateAuthGate — authorized & scoped", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const r = evaluateAuthGate(
    {
      live_jobber_test_enabled: true,
      authorized_conversation_id: "c",
      authorized_slot_id: "s",
      authorized_idempotency_key: "chat|c|s",
      authorization_expires_at: "2026-08-01T13:00:00Z",
    },
    { conversationId: "c", slotId: "s", authKey: "chat|c|s" },
    now,
  );
  assertEquals(r, { ok: true, reason: "authorized" });
});

Deno.test("safeStageLabel formats phase + step", () => {
  assertEquals(safeStageLabel("prepare", "quote_firm"), "Preparation → quote_firm");
  assertEquals(safeStageLabel("checkpoint"), "Awaiting operations-admin authorization");
  assertEquals(safeStageLabel("execute"), "Live Jobber write");
});

Deno.test("APPROVED_TEST_EMAIL is the owner-approved test identity", () => {
  assertEquals(APPROVED_TEST_EMAIL, "blmillen@gmail.com");
});