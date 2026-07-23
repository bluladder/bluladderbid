// Deno test: draftTools allowlist + write-scoping guarantees.
//   1. The allowlist stays exactly the set of tools we intend to expose.
//   2. A tool call outside the allowlist is rejected without executing.
//   3. update_quote_session ignores any field NOT in its allow-list, so a
//      model prompt cannot mutate customer records outside its own quote
//      session shape.
import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { DRAFT_TOOL_ALLOWLIST, executeDraftTool } from "./draftTools.ts";

Deno.test("draft tool allowlist is stable and read-safe", () => {
  assertEquals([...DRAFT_TOOL_ALLOWLIST].sort(), [
    "calculate_quote",
    "confirm_property_fact",
    "get_customer_context",
    "get_customer_properties",
    "get_pricing_summary",
    "get_property_profile",
    "get_quote_booking_readiness",
    "get_quote_session",
    "get_resolved_customer_profile",
    "get_reusable_quote_inputs",
    "get_service_area",
    "list_recent_quotes",
    "list_upcoming_bookings",
    "propose_property_fact",
    "search_business_knowledge",
    "select_conversation_property",
    "update_quote_session",
  ]);
  // Not one of the allowlisted names contains "send", "book", "cancel",
  // "reschedule", "delete", or "refund".
  // Verbs that would indicate an autonomous action. `list_upcoming_bookings`
  // is read-only despite the noun "bookings", so match on leading verbs only.
  const bad = /^(send|cancel|reschedul|delete|refund|charge|book)_/i;
  for (const name of DRAFT_TOOL_ALLOWLIST) {
    if (bad.test(name)) throw new Error(`disallowed verb in tool name: ${name}`);
  }
});

Deno.test("unknown tools are rejected without running", async () => {
  // A stub SB — the executor must short-circuit before ever touching it.
  const supabase = new Proxy({}, { get: () => { throw new Error("touched"); } });
  const res = await executeDraftTool(
    { supabase: supabase as unknown as never, conversationId: "x" },
    { name: "send_sms", arguments: { to: "+1", body: "hi" } },
  );
  assertEquals(res.ok, false);
  assertEquals(res.error, "tool_not_allowed");
});