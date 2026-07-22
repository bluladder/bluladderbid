// Deterministic sequencing tests for the residential-quote FSM. No DB, no
// model — pure inputs → typed action. Locks in the anti-regression contract
// for call 019f8a84-... (repeated questions, city stall, missing price).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { decideResidentialQuoteAction } from "./workflows/residentialQuote.ts";
import type { QuoteSession } from "../quoteSession.ts";

function baseSession(over: Partial<QuoteSession> = {}): QuoteSession {
  return {
    id: "qs_test",
    channel: "voice",
    conversationIds: ["c1"],
    fields: {},
    fieldStatus: {},
    requiredRemaining: [],
    quoteStatus: "none",
    bookingReady: false,
    ...over,
  };
}

Deno.test("asks for services first when nothing is known", () => {
  const s = baseSession();
  const a = decideResidentialQuoteAction(s);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "services");
});

Deno.test("with service known, asks for sqft next (not city)", () => {
  const s = baseSession({
    fields: { services: ["windowCleaning"] },
    fieldStatus: { services: "captured" },
  });
  const a = decideResidentialQuoteAction(s);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "squareFootage");
});

Deno.test("never re-asks a captured field (regression: 019f8a84 repeats)", () => {
  const s = baseSession({
    fields: { services: ["windowCleaning"], squareFootage: 2000 },
    fieldStatus: { services: "captured", squareFootage: "captured" },
  });
  const a = decideResidentialQuoteAction(s);
  if (a.kind === "ask") {
    assertEquals(a.field !== "services" && a.field !== "squareFootage", true);
  }
});

Deno.test("all pricing fields present → calculate_price (no city required)", () => {
  const s = baseSession({
    fields: {
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
    },
    fieldStatus: {
      services: "captured", squareFootage: "captured", stories: "captured", windowCleaningSides: "captured",
    },
  });
  assertEquals(decideResidentialQuoteAction(s).kind, "calculate_price");
});

Deno.test("pricing error surfaces as handoff, never as another intake question", () => {
  const s = baseSession({
    fields: {
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
    },
    fieldStatus: {
      services: "captured", squareFootage: "captured", stories: "captured", windowCleaningSides: "captured",
    },
    quoteStatus: "error",
  });
  const a = decideResidentialQuoteAction(s);
  assertEquals(a.kind, "handoff");
  if (a.kind === "handoff") assertEquals(a.reason, "pricing_error");
});

Deno.test("priced → speak_price first, then collects booking fields", () => {
  const s = baseSession({
    fields: {
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
    },
    fieldStatus: {
      services: "captured", squareFootage: "captured", stories: "captured", windowCleaningSides: "captured",
    },
    quoteStatus: "estimated",
  });
  assertEquals(decideResidentialQuoteAction(s).kind, "speak_price");
});
