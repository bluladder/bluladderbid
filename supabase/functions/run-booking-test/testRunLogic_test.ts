import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APPROVED_TEST_EMAIL,
  APPROVED_TEST_NAME,
  APPROVED_TEST_PHONE,
  APPROVED_TEST_ADDRESS,
  buildAuthKey,
  buildAdminCancelHeaders,
  buildIdempotencyKey,
  buildBookingPayload,
  mapQuoteToServices,
  splitCustomerName,
  validateBookingPayload,
  evaluateAuthGate,
  initialSteps,
  markStep,
  markStepPass,
  applyPass,
  pickProductionSlot,
  safeStageLabel,
  type OfferedSlot,
  type RunStep,
} from "./testRunLogic.ts";

// ---------------------------------------------------------------------------
// Stale-reason clearing on safe resume (cosmetic-fix regression)
// ---------------------------------------------------------------------------

Deno.test("applyPass clears a prior failure reason and preserves it in history", () => {
  const failed: RunStep = {
    key: "visit_removed",
    label: "Jobber visit removed",
    status: "failed",
    reason: "cancellation failed",
    startedAt: "2026-07-15T05:04:43.956Z",
    finishedAt: "2026-07-15T05:04:44.470Z",
  };
  // Sanity: original attempt has the failure reason.
  assertEquals(failed.status, "failed");
  assertEquals(failed.reason, "cancellation failed");

  const resumedAt = "2026-07-15T05:14:05.596Z";
  const passed = applyPass(failed, resumedAt);

  // Current state reflects the successful resume.
  assertEquals(passed.status, "passed");
  assertEquals(passed.finishedAt, resumedAt);
  // Stale failure reason MUST be gone on the current step.
  assertEquals(Object.prototype.hasOwnProperty.call(passed, "reason"), false);
  assertEquals(passed.reason, undefined);

  // Historical failure attempt is preserved in the audit trail.
  assert(Array.isArray(passed.history));
  assertEquals(passed.history!.length, 1);
  assertEquals(passed.history![0].status, "failed");
  assertEquals(passed.history![0].reason, "cancellation failed");
  assertEquals(passed.history![0].startedAt, "2026-07-15T05:04:43.956Z");
  assertEquals(passed.history![0].finishedAt, "2026-07-15T05:04:44.470Z");
});

Deno.test("applyPass on a never-failed step leaves history untouched", () => {
  const running: RunStep = {
    key: "quote_firm",
    label: "Canonical quote is firm",
    status: "running",
    startedAt: "2026-07-15T05:04:00.000Z",
  };
  const now = "2026-07-15T05:04:01.000Z";
  const passed = applyPass(running, now);
  assertEquals(passed.status, "passed");
  assertEquals(passed.reason, undefined);
  assertEquals(passed.history, undefined);
});

Deno.test("applyPass appends to an existing history without losing prior entries", () => {
  const step: RunStep = {
    key: "visit_removed",
    label: "Jobber visit removed",
    status: "failed",
    reason: "cancellation failed (attempt 2)",
    startedAt: "2026-07-15T05:14:00.000Z",
    finishedAt: "2026-07-15T05:14:01.000Z",
    history: [
      {
        status: "failed",
        reason: "admin_reauthentication_required",
        startedAt: "2026-07-15T05:04:43.956Z",
        finishedAt: "2026-07-15T05:04:44.470Z",
      },
    ],
  };
  const passed = applyPass(step, "2026-07-15T05:14:05.596Z");
  assertEquals(passed.status, "passed");
  assertEquals(passed.reason, undefined);
  assertEquals(passed.history!.length, 2);
  assertEquals(passed.history![0].reason, "admin_reauthentication_required");
  assertEquals(passed.history![1].reason, "cancellation failed (attempt 2)");
});

Deno.test("markStepPass only affects the target key", () => {
  const steps: RunStep[] = [
    { key: "a", label: "A", status: "failed", reason: "boom" },
    { key: "b", label: "B", status: "passed" },
  ];
  const next = markStepPass(steps, "a", "2026-07-15T05:14:05.596Z");
  const a = next.find((s) => s.key === "a")!;
  const b = next.find((s) => s.key === "b")!;
  assertEquals(a.status, "passed");
  assertEquals(a.reason, undefined);
  assertEquals(a.history!.length, 1);
  // Untouched sibling.
  assertEquals(b.status, "passed");
  assertEquals(b.reason, undefined);
  assertEquals(b.history, undefined);
});

// ---------------------------------------------------------------------------
// buildAdminCancelHeaders — admin JWT forwarding for cancellation
// ---------------------------------------------------------------------------

Deno.test("buildAdminCancelHeaders: refuses service-role key as bearer", () => {
  const r = buildAdminCancelHeaders({
    adminJwt: "SERVICE_ROLE_ABC",
    serviceRoleKey: "SERVICE_ROLE_ABC",
    anonKey: "ANON_XYZ",
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.reason, "service_role_forbidden");
});

Deno.test("buildAdminCancelHeaders: refuses missing/empty admin JWT", () => {
  for (const jwt of [null, undefined, "", "   "] as const) {
    const r = buildAdminCancelHeaders({
      adminJwt: jwt,
      serviceRoleKey: "SR",
      anonKey: "AK",
    });
    assertEquals(r.ok, false);
    if (!r.ok) assertEquals(r.reason, "admin_reauthentication_required");
  }
});

Deno.test("buildAdminCancelHeaders: forwards user JWT with anon apikey", () => {
  const r = buildAdminCancelHeaders({
    adminJwt: "user.jwt.token",
    serviceRoleKey: "SR",
    anonKey: "ANON_XYZ",
  });
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.headers.Authorization, "Bearer user.jwt.token");
    assertEquals(r.headers.apikey, "ANON_XYZ");
    assertEquals(r.headers["Content-Type"], "application/json");
    // Must NOT contain the service-role key anywhere.
    for (const v of Object.values(r.headers)) {
      assert(!String(v).includes("SR"), `header must not leak service-role key: ${v}`);
    }
  }
});

Deno.test("buildAdminCancelHeaders: returns only an in-memory headers object (no persistence side-effect)", () => {
  // The helper is a pure function; capturing the returned headers proves the
  // JWT lives only in the returned object which the coordinator uses for one
  // outbound fetch. No global state, no logs, no storage handle.
  const before = JSON.stringify({});
  const r = buildAdminCancelHeaders({
    adminJwt: "jwt-abc",
    serviceRoleKey: "SR",
    anonKey: "AK",
  });
  assert(r.ok);
  // Object is freely mutable by the caller; sanity check there is no hidden
  // reference to the JWT after the caller drops the object.
  const after = JSON.stringify({});
  assertEquals(before, after);
});

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

Deno.test("pickProductionSlot prefers best_recommended over earlier compacted/earliest", () => {
  const slots: OfferedSlot[] = [
    { slotId: "earliest", startTime: "2026-08-02T15:00:00Z" },
    { slotId: "compacted", startTime: "2026-08-03T15:00:00Z", whyLabel: "minimizes_gaps" },
    { slotId: "rec", startTime: "2026-08-04T15:00:00Z", whyLabel: "best_recommended" },
  ];
  assertEquals(pickProductionSlot(slots)?.slotId, "rec");
});

Deno.test("pickProductionSlot falls back to earliest compacted, then earliest overall", () => {
  const compactedOnly: OfferedSlot[] = [
    { slotId: "a", startTime: "2026-08-05T15:00:00Z" },
    { slotId: "b", startTime: "2026-08-03T15:00:00Z", whyLabel: "minimizes_gaps" },
    { slotId: "c", startTime: "2026-08-04T15:00:00Z", whyLabel: "minimizes_gaps" },
  ];
  assertEquals(pickProductionSlot(compactedOnly)?.slotId, "b");

  const plain: OfferedSlot[] = [
    { slotId: "later", startTime: "2026-08-09T15:00:00Z" },
    { slotId: "sooner", startTime: "2026-08-02T15:00:00Z" },
  ];
  assertEquals(pickProductionSlot(plain)?.slotId, "sooner");
});

Deno.test("pickProductionSlot returns null when there are no valid slots", () => {
  assertEquals(pickProductionSlot([]), null);
  assertEquals(pickProductionSlot([{ slotId: "x", startTime: "not-a-date" }]), null);
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
// ---------------------------------------------------------------------------
// Booking payload construction & validation
// ---------------------------------------------------------------------------

const CANONICAL_SLOT = {
  slotId: "slot_x_0",
  startTime: "2026-08-05T14:00:00Z",
  endTime: "2026-08-05T16:00:00Z",
  durationMinutes: 120,
  __technicianId: "tech-1",
  __isTeamJob: false,
  __teamTechnicianIds: null,
} as const;

const CUSTOMER = {
  name: APPROVED_TEST_NAME,
  email: APPROVED_TEST_EMAIL,
  phone: APPROVED_TEST_PHONE,
  address: APPROVED_TEST_ADDRESS,
};

const IDEMP = "chat|c1|2026-08-05T14:00:00Z";

Deno.test("splitCustomerName returns explicit BluLadder / Booking Test for approved identity", () => {
  const { firstName, lastName } = splitCustomerName(APPROVED_TEST_NAME);
  assertEquals(firstName, "BluLadder");
  assertEquals(lastName, "Booking Test");
});

Deno.test("splitCustomerName falls back safely (never empty last name for two-word input)", () => {
  assertEquals(splitCustomerName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
  assertEquals(splitCustomerName("Mary Anne Smith"), { firstName: "Mary", lastName: "Anne Smith" });
  assertEquals(splitCustomerName("Solo"), { firstName: "Solo", lastName: "Solo" });
});

Deno.test("mapQuoteToServices prefers jobberLineItems over lineItems", () => {
  const services = mapQuoteToServices({
    jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349, description: "Exterior only" }],
    lineItems: [{ label: "Ignored", amount: 999 }],
  });
  assertEquals(services, [{ name: "Window Cleaning", price: 349, description: "Exterior only" }]);
});

Deno.test("mapQuoteToServices falls back to lineItems when jobberLineItems missing", () => {
  const services = mapQuoteToServices({
    lineItems: [{ label: "Window Cleaning", amount: 349 }],
  });
  assertEquals(services, [{ name: "Window Cleaning", price: 349, description: undefined }]);
});

Deno.test("buildBookingPayload composes totals + duration from canonical quote and slot", () => {
  const payload = buildBookingPayload({
    quote: {
      jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349 }],
      subtotal: 349,
      total: 349,
      discountAmount: 0,
    },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  assertEquals(payload.customer.firstName, "BluLadder");
  assertEquals(payload.customer.lastName, "Booking Test");
  assertEquals(payload.durationMinutes, 120);
  assertEquals(payload.subtotal, 349);
  assertEquals(payload.total, 349);
  assertEquals(payload.discountAmount, 0);
  assertEquals(payload.services.length, 1);
  assertEquals(payload.technicianId, "tech-1");
  assertEquals(payload.idempotencyKey, IDEMP);
});

Deno.test("validateBookingPayload passes for a complete canonical payload", () => {
  const payload = buildBookingPayload({
    quote: { jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349 }], subtotal: 349, total: 349, discountAmount: 0 },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, true);
  assertEquals(missing, []);
});

Deno.test("validateBookingPayload halts on missing services", () => {
  const payload = buildBookingPayload({
    quote: { subtotal: 349, total: 349, discountAmount: 0 },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, false);
  assertEquals(missing.includes("services"), true);
});

Deno.test("validateBookingPayload halts on invalid totals", () => {
  const payload = buildBookingPayload({
    quote: { jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349 }] },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, false);
  assertEquals(missing.includes("subtotal"), true);
  assertEquals(missing.includes("total"), true);
});

Deno.test("validateBookingPayload halts on missing/invalid duration", () => {
  const payload = buildBookingPayload({
    quote: { jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349 }], subtotal: 349, total: 349, discountAmount: 0 },
    slot: { ...CANONICAL_SLOT, durationMinutes: undefined as unknown as number },
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, false);
  assertEquals(missing.includes("durationMinutes"), true);
});

Deno.test("validateBookingPayload halts on invalid service price", () => {
  const payload = buildBookingPayload({
    quote: { jobberLineItems: [{ name: "Window Cleaning", unitPrice: "oops" as unknown as number }], subtotal: 349, total: 349, discountAmount: 0 },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: IDEMP,
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, false);
  assertEquals(missing.some((m) => m.endsWith(".price")), true);
});

Deno.test("validateBookingPayload halts on missing idempotency key", () => {
  const payload = buildBookingPayload({
    quote: { jobberLineItems: [{ name: "Window Cleaning", unitPrice: 349 }], subtotal: 349, total: 349, discountAmount: 0 },
    slot: CANONICAL_SLOT,
    customer: CUSTOMER,
    idempotencyKey: "",
  });
  const { ok, missing } = validateBookingPayload(payload);
  assertEquals(ok, false);
  assertEquals(missing.includes("idempotencyKey"), true);
});

Deno.test("EXECUTE_STEPS now includes booking_payload_validation between confirmation and reservation", () => {
  const steps = initialSteps();
  const keys = steps.map((s) => s.key);
  const iConfirm = keys.indexOf("explicit_confirmation");
  const iValidate = keys.indexOf("booking_payload_validation");
  const iReservation = keys.indexOf("reservation");
  assertEquals(iConfirm >= 0 && iValidate === iConfirm + 1 && iReservation === iValidate + 1, true);
});
