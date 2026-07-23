// Deno tests for resend-webhook event mapping and transition guards.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { mapEventToAttemptStatus, shouldApplyTransition } from "./index.ts";

Deno.test("email.sent → sent", () => {
  assertEquals(mapEventToAttemptStatus("email.sent")?.status, "sent");
});
Deno.test("email.delivered → delivered", () => {
  assertEquals(mapEventToAttemptStatus("email.delivered")?.status, "delivered");
});
Deno.test("email.delivery_delayed → delayed", () => {
  assertEquals(mapEventToAttemptStatus("email.delivery_delayed")?.status, "delayed");
});
Deno.test("email.bounced / email.hard_bounced → bounced", () => {
  assertEquals(mapEventToAttemptStatus("email.bounced")?.status, "bounced");
  assertEquals(mapEventToAttemptStatus("email.hard_bounced")?.status, "bounced");
});
Deno.test("email.complained → complained", () => {
  assertEquals(mapEventToAttemptStatus("email.complained")?.status, "complained");
});
Deno.test("email.failed → failed", () => {
  assertEquals(mapEventToAttemptStatus("email.failed")?.status, "failed");
});
Deno.test("opened/clicked are ignored", () => {
  assertEquals(mapEventToAttemptStatus("email.opened"), null);
  assertEquals(mapEventToAttemptStatus("email.clicked"), null);
});

// Transition guards ----------------------------------------------------------
Deno.test("accepted → any: allowed", () => {
  assertEquals(shouldApplyTransition("accepted", "delivered"), true);
  assertEquals(shouldApplyTransition("accepted", "sent"), true);
  assertEquals(shouldApplyTransition(null, "bounced"), true);
});
Deno.test("delayed does not overwrite delivered", () => {
  assertEquals(shouldApplyTransition("delivered", "delayed"), false);
});
Deno.test("sent does not regress delivered", () => {
  assertEquals(shouldApplyTransition("delivered", "sent"), false);
});
Deno.test("bounced (terminal) cannot be overwritten by delivered", () => {
  assertEquals(shouldApplyTransition("bounced", "delivered"), false);
});
Deno.test("complained (terminal) cannot be overwritten", () => {
  assertEquals(shouldApplyTransition("complained", "delivered"), false);
  assertEquals(shouldApplyTransition("complained", "sent"), false);
});
Deno.test("sent → delayed allowed (forward)", () => {
  assertEquals(shouldApplyTransition("sent", "delayed"), true);
});
Deno.test("delayed → delivered allowed (forward)", () => {
  assertEquals(shouldApplyTransition("delayed", "delivered"), true);
});
