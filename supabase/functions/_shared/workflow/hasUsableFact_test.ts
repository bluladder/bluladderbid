import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasUsableFact, normalizeWindowSides } from "./hasUsableFact.ts";
import type { QuoteSession } from "../quoteSession.ts";

const s: QuoteSession = {
  id: "x", channel: "voice", conversationIds: [],
  fields: { services: ["windowCleaning"], squareFootage: 2000, address: "  " },
  fieldStatus: { services: "captured", squareFootage: "corrected" },
  requiredRemaining: [], quoteStatus: "none", bookingReady: false,
};

Deno.test("captured field is usable", () => assertEquals(hasUsableFact("services", s), true));
Deno.test("corrected field is usable", () => assertEquals(hasUsableFact("squareFootage", s), true));
Deno.test("whitespace-only address is not usable", () => assertEquals(hasUsableFact("address", s), false));
Deno.test("missing field is not usable", () => assertEquals(hasUsableFact("stories", s), false));

Deno.test("normalizeWindowSides: outside variants", () => {
  assertEquals(normalizeWindowSides("outside only"), "outside_only");
  assertEquals(normalizeWindowSides("exterior only"), "outside_only");
  assertEquals(normalizeWindowSides("just the outside"), "outside_only");
});
Deno.test("normalizeWindowSides: both variants", () => {
  assertEquals(normalizeWindowSides("inside and outside"), "inside_and_outside");
  assertEquals(normalizeWindowSides("both sides"), "inside_and_outside");
  assertEquals(normalizeWindowSides("full service"), "inside_and_outside");
});
Deno.test("normalizeWindowSides: ambiguous", () => {
  assertEquals(normalizeWindowSides("clean my windows"), null);
});
