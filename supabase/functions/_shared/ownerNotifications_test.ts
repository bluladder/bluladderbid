// Unit tests — pure helpers only (no DB).
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildInboundOwnerMessage,
  isGenuineInboundCustomerMessage,
} from "./ownerNotifications.ts";
import type { ResolvedContext } from "./conversationContext.ts";

const baseCtx: ResolvedContext = {
  conversationId: "conv-1",
  customerId: "cust-1",
  customerName: "Jane Doe",
  customerEmail: "jane@example.com",
  latestQuoteId: "abcdef1234567890",
  latestBookingId: null,
  serviceAddress: "123 Main St, Dallas, TX",
  resolutionMethod: "phone_exact",
  resolutionConfidence: "high",
  unresolvedReason: null,
  matchNeedsReview: false,
};

Deno.test("buildInboundOwnerMessage — high-confidence includes all fields, no review flag", () => {
  const msg = buildInboundOwnerMessage(
    { providerMessageId: "p1", fromPhone: "+14695551234", messagePreview: "hey can we reschedule?", context: baseCtx },
    "https://bid.bluladder.com/admin?tab=conversations&conversation=conv-1",
  );
  const expected = [
    "BluLadder: new customer reply",
    "From: Jane Doe (+14695551234)",
    "Address: 123 Main St, Dallas, TX",
    "Quote: abcdef12",
    "Msg: hey can we reschedule?",
    "Open: https://bid.bluladder.com/admin?tab=conversations&conversation=conv-1",
  ].join("\n");
  assertEquals(msg, expected);
});

Deno.test("buildInboundOwnerMessage — ambiguous match surfaces review flag", () => {
  const ctx: ResolvedContext = {
    ...baseCtx,
    customerId: null, customerName: null, customerEmail: null,
    serviceAddress: null, latestQuoteId: null,
    resolutionMethod: "ambiguous", resolutionConfidence: "ambiguous",
    unresolvedReason: "multiple_customers_share_phone", matchNeedsReview: true,
  };
  const msg = buildInboundOwnerMessage(
    { providerMessageId: "p2", fromPhone: "+14695559999", messagePreview: "hi", context: ctx },
    "https://x/y",
  );
  const lines = msg.split("\n");
  assertEquals(lines[0], "BluLadder: new customer reply");
  assertEquals(lines[1], "From: +14695559999");
  assertEquals(lines.includes("Customer match needs review"), true);
});

Deno.test("isGenuineInboundCustomerMessage — accepts normal customer reply", () => {
  const r = isGenuineInboundCustomerMessage({
    content: "yes please schedule",
    complianceIntent: null,
    richIntentKind: "general",
    fromPhone: "+14695551234",
    ownedSenderNumbers: ["+14697472877"],
    eventType: "inbound_sms",
  });
  assertEquals(r.ok, true);
});

Deno.test("isGenuineInboundCustomerMessage — rejects STOP compliance", () => {
  const r = isGenuineInboundCustomerMessage({
    content: "STOP",
    complianceIntent: "stop",
    richIntentKind: "stop",
    fromPhone: "+14695551234",
    ownedSenderNumbers: [],
    eventType: "inbound_sms",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "compliance_stop");
});

Deno.test("isGenuineInboundCustomerMessage — rejects delivery receipts", () => {
  const r = isGenuineInboundCustomerMessage({
    content: "",
    complianceIntent: null,
    richIntentKind: "general",
    fromPhone: "+14695551234",
    ownedSenderNumbers: [],
    eventType: "delivery_receipt",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "delivery_receipt");
});

Deno.test("isGenuineInboundCustomerMessage — rejects messages from BluLadder-owned numbers", () => {
  const r = isGenuineInboundCustomerMessage({
    content: "hi",
    complianceIntent: null,
    richIntentKind: "general",
    fromPhone: "+14697472877",
    ownedSenderNumbers: ["+14697472877"],
    eventType: "inbound_sms",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "from_owned_number");
});

Deno.test("isGenuineInboundCustomerMessage — rejects empty body", () => {
  const r = isGenuineInboundCustomerMessage({
    content: "   ",
    complianceIntent: null,
    richIntentKind: "general",
    fromPhone: "+14695551234",
    ownedSenderNumbers: [],
    eventType: "inbound_sms",
  });
  assertEquals(r.ok, false);
  assertEquals(r.reason, "empty_body");
});
