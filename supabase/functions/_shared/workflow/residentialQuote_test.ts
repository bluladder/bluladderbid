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

/** Convenience: a session whose early callback field is already captured, so
 *  pricing-intake assertions read cleanly. */
function afterContact(over: Partial<QuoteSession> = {}): QuoteSession {
  return baseSession({
    ...over,
    fields: { name: "Alex", phone: "+14695551212", ...(over.fields ?? {}) },
    fieldStatus: {
      name: "captured",
      phone: "captured",
      ...(over.fieldStatus ?? {}),
    },
  });
}

Deno.test("intent-first: asks for services before contact details", () => {
  const s = baseSession();
  const a = decideResidentialQuoteAction(s);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "services");
});

Deno.test("voice asks for mobile phone after service intent", () => {
  const s = baseSession({
    fields: { services: ["houseWash"] },
    fieldStatus: { services: "captured" },
  });
  const a = decideResidentialQuoteAction(s);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "contact_phone");
});

Deno.test("after contact, asks for services when nothing else is known", () => {
  const a = decideResidentialQuoteAction(afterContact());
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "services");
});

Deno.test("with service+scope known, asks for sqft next (not city)", () => {
  const s = afterContact({
    fields: { services: ["windowCleaning"], windowCleaningScope: "whole_home" },
    fieldStatus: { services: "captured", windowCleaningScope: "captured" },
  });
  // Engine authority: it still needs squareFootage + stories.
  const a = decideResidentialQuoteAction(s, ["squareFootage", "stories"]);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "squareFootage");
});

Deno.test("canonical wording: square footage prompt names the exact field", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      windowCleaningScope: "whole_home",
    },
    fieldStatus: {
      services: "captured",
      windowCleaningScope: "captured",
    },
  });
  const a = decideResidentialQuoteAction(s, ["squareFootage"]);
  if (a.kind === "ask") {
    assertEquals(a.prompt, "How many square feet is your home?");
  }
});

Deno.test("approved whole-home default asks square footage without a routine scope question", () => {
  const s = afterContact({
    fields: { services: ["windowCleaning"] },
    fieldStatus: { services: "captured" },
  });
  const a = decideResidentialQuoteAction(s, ["squareFootage"]);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") {
    assertEquals(a.field, "squareFootage");
    assertEquals(
      a.prompt,
      "How many square feet is your home?",
    );
  }
});

Deno.test("never re-asks a captured field (regression: 019f8a84 repeats)", () => {
  const s = afterContact({
    fields: { services: ["windowCleaning"], squareFootage: 2000 },
    fieldStatus: { services: "captured", squareFootage: "captured" },
  });
  const a = decideResidentialQuoteAction(s, ["stories"]);
  if (a.kind === "ask") {
    assertEquals(a.field !== "services" && a.field !== "squareFootage", true);
  }
});

Deno.test("all pricing fields present → calculate_price (no city required)", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      windowCleaningScope: "whole_home",
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
  });
  // Engine reports nothing missing → move to pricing.
  assertEquals(decideResidentialQuoteAction(s, []).kind, "calculate_price");
});

Deno.test("express whole-home windows calculate both packages before side selection", () => {
  const s = baseSession({
    fields: {
      voiceJourney: {
        intent: "new_quote",
        policyVersion: "voice-express-v1",
      },
      services: ["windowCleaning"],
      customerType: "residential",
      windowCleaningScope: "whole_home",
      squareFootage: 2000,
      stories: 1,
      condition: "maintenance",
      advancedWindowConditions: false,
      hardWaterStains: false,
      frenchPanes: false,
      ladderWork: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
    },
  });
  assertEquals(
    decideResidentialQuoteAction(s, ["windowCleaningSides"]),
    { kind: "calculate_price" },
  );
});

Deno.test("approved whole-home default no longer causes owner-decision handoff", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
  });
  assertEquals(decideResidentialQuoteAction(s, []), {
    kind: "calculate_price",
  });
});

Deno.test("pricing error surfaces as handoff, never as another intake question", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      windowCleaningScope: "whole_home",
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
    quoteStatus: "error",
  });
  const a = decideResidentialQuoteAction(s, []);
  assertEquals(a.kind, "handoff");
  if (a.kind === "handoff") assertEquals(a.reason, "pricing_error");
});

Deno.test("priced → speak_price first, then collects booking fields", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      windowCleaningScope: "whole_home",
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
    quoteStatus: "estimated",
  });
  assertEquals(decideResidentialQuoteAction(s, []).kind, "speak_price");
});

Deno.test("post-quote: asks for email before booking (not before speaking the price)", () => {
  const s = afterContact({
    fields: {
      services: ["windowCleaning"],
      windowCleaningScope: "whole_home",
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      windowCleaningSides: "captured",
      condition: "captured",
    },
    quoteStatus: "estimated",
    lastStep: "priced_spoken",
  });
  const a = decideResidentialQuoteAction(s, []);
  assertEquals(a.kind, "ask");
  if (a.kind === "ask") assertEquals(a.field, "contact_email");
});

Deno.test("mixed quote calculates before manual-review disposition so firm portions survive", () => {
  const s = afterContact({
    fields: {
      services: ["houseWash", "screenRepair"],
      squareFootage: 2200,
      stories: 1,
      enclosedPatioProfile: "none",
      screenRepairCount: 2,
      screenRepairScopeType: "screen_door",
    },
    fieldStatus: {
      services: "captured",
      squareFootage: "captured",
      stories: "captured",
      screenRepairCount: "captured",
      screenRepairScopeType: "captured",
    },
  });
  assertEquals(decideResidentialQuoteAction(s, []).kind, "calculate_price");
});
