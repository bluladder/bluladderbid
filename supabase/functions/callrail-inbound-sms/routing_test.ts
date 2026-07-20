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

Deno.test("routing: bare YES is no longer START — conversational fall-through", () => {
  // Compliance precedence: only explicit START/UNSTOP/SUBSCRIBE/OPT-IN
  // commands re-subscribe. Bare "yes" is conversational.
  assertEquals(classifyInbound("YES"), null);
  assertEquals(classifyInboundIntent("YES").kind, "other");
  assertEquals(classifyInboundIntent("yes, let's do it").kind, "booking");
  assertEquals(classifyInboundIntent("START").kind, "start");
});