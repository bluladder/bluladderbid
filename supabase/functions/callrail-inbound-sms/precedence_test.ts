import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyInbound } from "../_shared/sms.ts";
import { classifyInboundIntent } from "../_shared/bookingIntent.ts";

// The webhook now decides STOP/START from classifyInboundIntent (richIntent),
// NOT from the legacy classifyInbound(). These tests pin the two decision
// paths so regressions are visible: the compliance precedence we ship is
// authoritative even though the legacy first-word classifier still exists.

Deno.test("bare YES is treated as compliance START (rich classifier)", () => {
  assertEquals(classifyInboundIntent("YES").kind, "start");
  assertEquals(classifyInboundIntent("yes").kind, "start");
});

Deno.test("multi-word booking phrases starting with yes are booking, not start", () => {
  const phrases = ["yes, let's do it", "yes book it", "yes, schedule me", "yes lets do it"];
  for (const p of phrases) {
    assertEquals(classifyInboundIntent(p).kind, "booking", `expected booking for "${p}"`);
  }
});

Deno.test("STOP short-circuits regardless of body content", () => {
  assertEquals(classifyInboundIntent("STOP").kind, "stop");
  assertEquals(classifyInboundIntent("stop please book me").kind, "stop");
});

Deno.test("HELP is deterministic and never sent to sales AI", () => {
  assertEquals(classifyInboundIntent("HELP").kind, "help");
  assertEquals(classifyInboundIntent("info").kind, "help");
});

Deno.test("Legacy first-word classifier still reports YES as start (documented divergence)", () => {
  // This proves why the webhook cannot rely on classifyInbound() alone for
  // start/stop routing: it would mis-opt-in customers replying "yes, let's do it".
  assertEquals(classifyInbound("yes, let's do it"), "start");
});