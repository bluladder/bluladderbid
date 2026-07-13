import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type ConversationFacts,
  computeState,
  allowedToolsForState,
  isToolAllowed,
  mergeFacts,
  quoteInputsKey,
  isQuoteCurrent,
  isSelectedSlotValid,
} from "./conversationState.ts";

function firmQuoteFacts(): ConversationFacts {
  const base: ConversationFacts = {
    services: ["window_cleaning"],
    address: "720 Parkland Dr, Aubrey, TX 76227",
    serviceArea: { status: "eligible" },
    property: { squareFootage: 2000, stories: 1, windowCleaningType: "exterior" },
  };
  base.quote = {
    status: "firm", firm: true, total: 199, lineItems: [{ name: "Windows" }],
    pricingVersion: 3, inputsKey: quoteInputsKey(base),
  };
  return base;
}

Deno.test("new conversation with nothing collected", () => {
  assertEquals(computeState({}), "new");
});

Deno.test("state follows the required order", () => {
  let f: ConversationFacts = { services: ["window_cleaning"] };
  assertEquals(computeState(f), "collecting_address");
  f = mergeFacts(f, { address: "720 Parkland Dr" });
  assertEquals(computeState(f), "validating_service_area");
  f = mergeFacts(f, { serviceArea: { status: "eligible" } });
  assertEquals(computeState(f), "pricing");
});

Deno.test("model cannot skip to availability before a firm quote", () => {
  const f: ConversationFacts = { services: ["window_cleaning"], address: "x", serviceArea: { status: "eligible" } };
  const state = computeState(f);
  assert(!isToolAllowed(state, "get_bluladder_availability"));
  assert(!isToolAllowed(state, "create_bluladder_booking"));
});

Deno.test("availability allowed only after firm quote + contact", () => {
  let f = firmQuoteFacts();
  assertEquals(computeState(f), "quote_ready"); // no contact yet
  assert(!isToolAllowed("quote_ready", "get_bluladder_availability"));
  f = mergeFacts(f, { contact: { email: "a@b.com", name: "Test" } });
  assertEquals(computeState(f), "checking_availability");
  assert(isToolAllowed("checking_availability", "get_bluladder_availability"));
});

Deno.test("booking allowed only in awaiting_booking_confirmation", () => {
  let f = mergeFacts(firmQuoteFacts(), { contact: { email: "a@b.com" } });
  f = mergeFacts(f, { availability: { offeredSlotIds: ["slot_1"], forQuoteKey: quoteInputsKey(f), fetchedAt: "now" } });
  assertEquals(computeState(f), "awaiting_booking_confirmation");
  assert(isToolAllowed("awaiting_booking_confirmation", "create_bluladder_booking"));
});

Deno.test("address change invalidates quote and availability", () => {
  let f = mergeFacts(firmQuoteFacts(), { contact: { email: "a@b.com" } });
  f = mergeFacts(f, { availability: { offeredSlotIds: ["slot_1"], forQuoteKey: quoteInputsKey(f), fetchedAt: "now" } });
  assertEquals(computeState(f), "awaiting_booking_confirmation");
  f = mergeFacts(f, { address: "999 New St, Dallas TX", serviceArea: { status: "eligible" } });
  assert(!isQuoteCurrent(f));
  assertEquals(f.availability, null);
  assertEquals(f.selectedSlotId ?? null, null);
  assertEquals(computeState(f), "pricing");
});

Deno.test("square footage change invalidates quote and selected slot", () => {
  let f = mergeFacts(firmQuoteFacts(), { contact: { email: "a@b.com" }, selectedSlotId: "slot_1" });
  f = mergeFacts(f, { availability: { offeredSlotIds: ["slot_1"], forQuoteKey: quoteInputsKey(f), fetchedAt: "now" } });
  f = mergeFacts(f, { property: { squareFootage: 5000 } });
  assert(!isQuoteCurrent(f));
  assertEquals(f.selectedSlotId ?? null, null);
});

Deno.test("service change invalidates quote", () => {
  let f = mergeFacts(firmQuoteFacts(), { contact: { email: "a@b.com" } });
  f = mergeFacts(f, { services: ["window_cleaning", "gutter_cleaning"] });
  assert(!isQuoteCurrent(f));
});

Deno.test("manual review services never become firm-bookable", () => {
  const f: ConversationFacts = {
    services: ["window_cleaning"], address: "x", serviceArea: { status: "eligible" },
    manualReviewReason: "solar_panel_cleaning requires a manual quote",
  };
  assertEquals(computeState(f), "manual_review");
  assert(!isToolAllowed("manual_review", "get_bluladder_availability"));
  assert(!isToolAllowed("manual_review", "create_bluladder_booking"));
});

Deno.test("geocoding failure stays in service-area validation, never eligible", () => {
  const f: ConversationFacts = {
    services: ["window_cleaning"], address: "x", serviceArea: { status: "validation_unavailable" },
  };
  assertEquals(computeState(f), "validating_service_area");
  assert(!isToolAllowed(computeState(f), "get_bluladder_availability"));
});

Deno.test("selected slot must originate from current offer", () => {
  let f = mergeFacts(firmQuoteFacts(), { contact: { email: "a@b.com" } });
  f = mergeFacts(f, { availability: { offeredSlotIds: ["slot_1", "slot_2"], forQuoteKey: quoteInputsKey(f), fetchedAt: "now" }, selectedSlotId: "slot_2" });
  assert(isSelectedSlotValid(f));
  f = mergeFacts(f, { selectedSlotId: "slot_99" });
  assert(!isSelectedSlotValid(f));
});

Deno.test("staff takeover and callback always allow human callback", () => {
  assert(isToolAllowed("staff_takeover", "request_human_callback"));
  assert(isToolAllowed("booked", "request_human_callback"));
  assert(allowedToolsForState("new").includes("request_human_callback"));
});

Deno.test("staff takeover overrides everything", () => {
  const f = mergeFacts(firmQuoteFacts(), { staffTakeover: true });
  assertEquals(computeState(f), "staff_takeover");
});
