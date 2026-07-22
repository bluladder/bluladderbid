// Regression tests for Phase 4C-β.6.2 — residential window-cleaning voice
// intake must capture window condition before quoting, matching the existing
// BluLadder Bid web workflow. No new voice-only required-field list: the
// shared intake manifest + residential FSM own this.

import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideResidentialQuoteAction } from "./workflows/residentialQuote.ts";
import {
  extractFactsHeuristic,
  normalizeWindowCondition,
} from "./factExtractor.ts";
import type { QuoteSession } from "../quoteSession.ts";

function contactReady(over: Partial<QuoteSession> = {}): QuoteSession {
  return {
    id: "qs_t",
    channel: "voice",
    conversationIds: ["c1"],
    fields: { name: "Alex", phone: "+14695551212", ...(over.fields ?? {}) },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      ...(over.fieldStatus ?? {}),
    },
    requiredRemaining: [],
    quoteStatus: "none",
    bookingReady: false,
    ...over,
  };
}

Deno.test("residential window: asks condition before calculate_price", () => {
  const s = contactReady({
    fields: {
      name: "Alex",
      phone: "+14695551212",
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
    },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
    },
  });
  const a = decideResidentialQuoteAction(s, []);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "windowCleaningCondition");
});

Deno.test("residential window: condition captured → moves to calculate_price", () => {
  const s = contactReady({
    fields: {
      name: "Alex",
      phone: "+14695551212",
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
    },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
  });
  assertEquals(decideResidentialQuoteAction(s, []).kind, "calculate_price");
});

Deno.test("residential window: previously captured condition is not re-asked", () => {
  const s = contactReady({
    fields: {
      name: "Alex",
      phone: "+14695551212",
      services: ["windowCleaning"],
      squareFootage: 2000,
      windowCleaningSides: "outside_only",
      condition: "heavy",
    },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      services: "captured",
      squareFootage: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
  });
  const a = decideResidentialQuoteAction(s, ["stories"]);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assert(a.field !== "windowCleaningCondition");
});

Deno.test("city is never asked as a pricing prerequisite", () => {
  const s = contactReady({
    fields: {
      name: "Alex",
      phone: "+14695551212",
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
    },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
  });
  const a = decideResidentialQuoteAction(s, []);
  // Must be calculate_price, never "ask city".
  assertEquals(a.kind, "calculate_price");
});

Deno.test("non-window services (e.g., house wash) do not gate on condition", () => {
  const s = contactReady({
    fields: {
      name: "Alex",
      phone: "+14695551212",
      services: ["houseWash"],
      squareFootage: 2000,
      stories: 2,
    },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
    },
  });
  const a = decideResidentialQuoteAction(s, []);
  assertEquals(a.kind, "calculate_price");
});

Deno.test("normalizeWindowCondition maps spoken answers to canonical values", () => {
  assertEquals(normalizeWindowCondition("they're regularly maintained"), "maintenance");
  assertEquals(normalizeWindowCondition("cleaned recently"), "maintenance");
  assertEquals(normalizeWindowCondition("pretty clean"), "maintenance");
  assertEquals(normalizeWindowCondition("heavily soiled"), "heavy");
  assertEquals(normalizeWindowCondition("noticeably dirty"), "heavy");
  assertEquals(normalizeWindowCondition("first time cleaning"), "heavy");
  assertEquals(normalizeWindowCondition("hasn't been cleaned in a while"), "heavy");
  assertEquals(normalizeWindowCondition("blue"), null);
});

Deno.test("factExtractor persists normalized condition on the session patch", () => {
  const r = extractFactsHeuristic({
    utterance: "They're heavily soiled with significant buildup.",
    history: [],
    currentFields: {},
  });
  assertEquals(r.patch.condition, "heavy");
});