import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyInboundIntent, renderBookingAutoReply } from "./bookingIntent.ts";

Deno.test("STOP always wins even when body also says book", () => {
  assertEquals(classifyInboundIntent("STOP").kind, "stop");
  assertEquals(classifyInboundIntent("stop please book me").kind, "stop");
});

Deno.test("HELP is recognized and does not enter booking or escalation paths", () => {
  assertEquals(classifyInboundIntent("HELP").kind, "help");
  assertEquals(classifyInboundIntent("help me schedule").kind, "help");
});

Deno.test("START keyword recognized", () => {
  assertEquals(classifyInboundIntent("START").kind, "start");
  assertEquals(classifyInboundIntent("Unstop").kind, "start");
});

Deno.test("Booking intent variations", () => {
  const phrases = [
    "BOOK IT",
    "book it",
    "Book",
    "schedule me",
    "schedule",
    "I'm ready",
    "im ready",
    "yes, let's do it",
    "yes lets book",
    "ready to schedule",
    "sign me up",
    "please book",
  ];
  for (const p of phrases) {
    assertEquals(classifyInboundIntent(p).kind, "booking", `expected booking for "${p}"`);
  }
});

Deno.test("Ambiguous / vague replies fall through to other", () => {
  const phrases = [
    "hmm maybe",
    "how much?",
    "what's included?",
    "does that price include tax",
    "sounds good",           // could be booking, but too vague — MUST NOT auto-book
    "yes",                   // deliberately treated as compliance START, not booking
  ];
  for (const p of phrases) {
    const r = classifyInboundIntent(p);
    assert(r.kind !== "booking", `should not be booking: "${p}" got ${r.kind}`);
  }
});

Deno.test("Escalation categories beat booking intent when both present", () => {
  const damage = classifyInboundIntent("you damaged my window, please book it");
  assertEquals(damage.kind, "escalation");
  if (damage.kind === "escalation") assertEquals(damage.category, "damage_or_safety");

  const billing = classifyInboundIntent("I was overcharged, book me for a refund");
  assertEquals(billing.kind, "escalation");
  if (billing.kind === "escalation") assertEquals(billing.category, "billing_dispute");

  const human = classifyInboundIntent("please have a real person call me");
  assertEquals(human.kind, "escalation");
  if (human.kind === "escalation") assertEquals(human.category, "human_request");

  const complaint = classifyInboundIntent("this is terrible");
  assertEquals(complaint.kind, "escalation");
  if (complaint.kind === "escalation") assertEquals(complaint.category, "complaint");
});

Deno.test("Auto-reply copy contains link and no PII fields", () => {
  const reply = renderBookingAutoReply({ firstName: "Sam", quoteLink: "https://bluladderbid.lovable.app/quote/abc-123" });
  assert(reply.includes("Sam"));
  assert(reply.includes("https://bluladderbid.lovable.app/quote/abc-123"));
  // No phone/email should ever be produced by this pure helper.
  assert(!/@|\+1\d{10}/.test(reply));
});

Deno.test("Auto-reply degrades gracefully without first name", () => {
  const reply = renderBookingAutoReply({ quoteLink: "https://example.com/quote/x" });
  assert(reply.startsWith("Great."));
});
