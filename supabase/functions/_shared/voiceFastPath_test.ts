import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyVoiceRoute, slowBranchAcknowledgement, stripVoiceControlTags, FLUSH_TAG } from "./voiceFastPath.ts";

Deno.test("fast path: service list question", () => {
  const r = classifyVoiceRoute("What services do you offer?");
  assertEquals(r.type, "fast_knowledge");
  if (r.type === "fast_knowledge") assertEquals(r.category, "service_list");
});

Deno.test("fast path: general service-area question", () => {
  const r = classifyVoiceRoute("Do you serve Frisco?");
  assertEquals(r.type, "fast_knowledge");
});

Deno.test("fast path: basic policy (guarantee)", () => {
  const r = classifyVoiceRoute("Do you have a satisfaction guarantee?");
  assertEquals(r.type, "fast_knowledge");
});

Deno.test("full path: pricing question forces full orchestrator", () => {
  const r = classifyVoiceRoute("How much does a house wash cost?");
  assertEquals(r.type, "full_orchestrator");
  if (r.type === "full_orchestrator") assertEquals(r.reason, "pricing_intent");
});

Deno.test("full path: address forces full orchestrator", () => {
  const r = classifyVoiceRoute("My address is 123 Main Street, Frisco");
  assertEquals(r.type, "full_orchestrator");
});

Deno.test("full path: availability", () => {
  const r = classifyVoiceRoute("What's your next opening?");
  assertEquals(r.type, "full_orchestrator");
  if (r.type === "full_orchestrator") assertEquals(r.reason, "availability_intent");
});

Deno.test("full path: explicit booking", () => {
  const r = classifyVoiceRoute("Yes, book it");
  assertEquals(r.type, "full_orchestrator");
});

Deno.test("full path: customer lookup phrasing", () => {
  const r = classifyVoiceRoute("Look up my last appointment");
  assertEquals(r.type, "full_orchestrator");
});

Deno.test("full path: empty message", () => {
  const r = classifyVoiceRoute("");
  assertEquals(r.type, "full_orchestrator");
});

Deno.test("full path: ambiguous fails closed", () => {
  const r = classifyVoiceRoute("hmm");
  assertEquals(r.type, "full_orchestrator");
  if (r.type === "full_orchestrator") assertEquals(r.reason, "ambiguous");
});

Deno.test("slowBranchAcknowledgement: pricing", () => {
  const ack = slowBranchAcknowledgement("pricing_intent");
  assert(ack && /check/i.test(ack));
});

Deno.test("slowBranchAcknowledgement: availability", () => {
  const ack = slowBranchAcknowledgement("availability_intent");
  assert(ack && /schedule/i.test(ack));
});

Deno.test("slowBranchAcknowledgement: booking", () => {
  const ack = slowBranchAcknowledgement("booking_intent");
  assert(ack && /help/i.test(ack));
});

Deno.test("stripVoiceControlTags removes flush and break tags", () => {
  const cleaned = stripVoiceControlTags(`Absolutely. ${FLUSH_TAG} here it is. <break time="500ms"/>`);
  assert(!cleaned.includes("flush"));
  assert(!cleaned.includes("break"));
  assertEquals(cleaned, "Absolutely.  here it is.");
});
