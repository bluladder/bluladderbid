import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyInbound } from "../_shared/sms.ts";
import { classifyInboundIntent } from "../_shared/bookingIntent.ts";

// classifyInboundIntent is authoritative. Compliance precedence (final):
//   STOP > HELP > explicit START > escalation > booking > other.
// A bare "YES" is NOT a START — only explicit opt-in commands are.

Deno.test("bare YES is NOT compliance START — routes to conversational other", () => {
  assertEquals(classifyInboundIntent("YES").kind, "other");
  assertEquals(classifyInboundIntent("yes").kind, "other");
});

Deno.test("explicit START keywords still opt the customer back in", () => {
  for (const cmd of ["START", "start", "UNSTOP", "subscribe", "opt in", "OPT-IN"]) {
    assertEquals(classifyInboundIntent(cmd).kind, "start", `expected start for "${cmd}"`);
  }
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

Deno.test("Legacy classifier no longer treats bare YES as start", () => {
  // Defense-in-depth: even the legacy first-word helper must not silently
  // opt customers back in on a bare "yes".
  assertEquals(classifyInbound("yes"), null);
  assertEquals(classifyInbound("yes, let's do it"), null);
  assertEquals(classifyInbound("START"), "start");
});