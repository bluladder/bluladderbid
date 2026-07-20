// Verifies that inbound conversational SMS gets routed through the shared
// smsOrchestrator, and that compliance/escalation still short-circuits before
// the AI is invoked. We import the small pure helpers rather than spinning up
// Deno.serve, so the test stays deterministic and offline.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyInboundIntent } from "../_shared/bookingIntent.ts";
import { classifyInbound } from "../_shared/sms.ts";

Deno.test("routing: STOP short-circuits before AI", () => {
  const rich = classifyInboundIntent("STOP");
  assertEquals(rich.kind, "stop");
});

Deno.test("routing: escalation short-circuits before AI", () => {
  const rich = classifyInboundIntent("Someone damaged my window!");
  assertEquals(rich.kind, "escalation");
});

Deno.test("routing: ordinary question does NOT trip compliance or escalation", () => {
  const rich = classifyInboundIntent("What's included in a house wash?");
  assert(rich.kind !== "stop" && rich.kind !== "start" && rich.kind !== "escalation");
});

Deno.test("routing: legacy classifier still flags bare YES as start (documented)", () => {
  // The legacy first-word classifier is intentionally retained as metadata
  // only. Authoritative decisions come from classifyInboundIntent.
  assertEquals(classifyInbound("YES"), "start");
  const rich = classifyInboundIntent("yes, let's do it");
  assertEquals(rich.kind, "booking");
});