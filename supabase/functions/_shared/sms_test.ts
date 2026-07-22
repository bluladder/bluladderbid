import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCallRailTextResponse } from "./sms.ts";

Deno.test("CallRail parser treats top-level id as conversation id, not message id", () => {
  const parsed = parseCallRailTextResponse({ id: "KXpGN" });
  assertEquals(parsed.conversationId, "KXpGN");
  assertEquals(parsed.messageId, undefined);
  assertEquals(parsed.providerMessageStatus, undefined);
});

Deno.test("CallRail parser captures distinct outbound message id and failed status", () => {
  const parsed = parseCallRailTextResponse({
    id: "KXpGN",
    messages: [
      { id: "SCI019f8c2116a27e3bb4e7d9c69331f622", direction: "outgoing", status: "failed" },
    ],
  });
  assertEquals(parsed.conversationId, "KXpGN");
  assertEquals(parsed.messageId, "SCI019f8c2116a27e3bb4e7d9c69331f622");
  assertEquals(parsed.providerMessageStatus, "failed");
});