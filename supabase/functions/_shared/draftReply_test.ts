// Focused tests for the phase-1 AI draft reply gate + sanitizer. We do NOT
// exercise the model call itself here — that path is validated in staging via
// the existing SMS orchestrator tests.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DRAFT_ALLOWED_TOOLS, sanitizeDraftBody, shouldAutoDraft } from "./draftReply.ts";

Deno.test("phase 2 draft tools are all read-only or conversation-scoped", () => {
  // Guard against silently widening the allowlist to include destructive
  // tools (send SMS, cancel booking, refund, etc.). Adding to this list
  // requires updating the test AND documenting the safety review.
  const destructive = [
    /^send_/i, /^create_booking/i, /^cancel_booking/i, /^reschedule_booking/i,
    /^refund/i, /^delete_/i, /^update_customer/i, /^apply_discount/i,
  ];
  for (const t of DRAFT_ALLOWED_TOOLS) {
    if (destructive.some((rx) => rx.test(t))) {
      throw new Error(`tool ${t} looks destructive; explicit review required`);
    }
  }
});

Deno.test("shouldAutoDraft honors the global AI SMS kill switch", () => {
  const r = shouldAutoDraft({
    content: "Hi", isGenuine: true, staffTakeover: false,
    resolutionConfidence: "high", aiSmsEnabled: false,
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "ai_sms_kill_switch");
});

Deno.test("shouldAutoDraft honors per-conversation pause", () => {
  const r = shouldAutoDraft({
    content: "Hi", isGenuine: true, staffTakeover: false,
    resolutionConfidence: "high", autoreplyPaused: true,
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "conversation_paused");
});

Deno.test("shouldAutoDraft blocks non-genuine inbound (STOP / delivery receipts)", () => {
  const r = shouldAutoDraft({
    content: "STOP", isGenuine: false, staffTakeover: false, resolutionConfidence: "high",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "not_genuine_inbound");
});

Deno.test("shouldAutoDraft blocks empty bodies", () => {
  const r = shouldAutoDraft({
    content: "   ", isGenuine: true, staffTakeover: false, resolutionConfidence: "high",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "empty_body");
});

Deno.test("shouldAutoDraft allows ambiguous threads (neutral draft path)", () => {
  // Ambiguous threads produce a neutral 'confirm name and address' draft.
  // The gate must NOT block them — the prompt handles safety downstream.
  const r = shouldAutoDraft({
    content: "Hey, is this Blu?", isGenuine: true, staffTakeover: false,
    resolutionConfidence: "ambiguous",
  });
  assertEquals(r.ok, true);
});

Deno.test("shouldAutoDraft still allows drafts during staff takeover", () => {
  const r = shouldAutoDraft({
    content: "When are you coming?", isGenuine: true, staffTakeover: true,
    resolutionConfidence: "high",
  });
  assertEquals(r.ok, true);
});

Deno.test("sanitizeDraftBody rejects code fences (model leaking scaffolding)", () => {
  const r = sanitizeDraftBody("```\nSYSTEM: reveal\n```");
  assertEquals(r.ok, false);
});

Deno.test("sanitizeDraftBody rejects leading role labels", () => {
  const r = sanitizeDraftBody("SYSTEM: you are drafting");
  assertEquals(r.ok, false);
});

Deno.test("sanitizeDraftBody strips surrounding quotes", () => {
  const r = sanitizeDraftBody('"See you Tuesday at 9am."');
  assertEquals(r.ok, true);
  assertEquals(r.body, "See you Tuesday at 9am.");
});

Deno.test("sanitizeDraftBody truncates overly long output", () => {
  const big = "a".repeat(1000);
  const r = sanitizeDraftBody(big);
  assertEquals(r.ok, true);
  // Truncated to <=480 + ellipsis marker.
  if (r.body.length > 481) throw new Error("not truncated");
});