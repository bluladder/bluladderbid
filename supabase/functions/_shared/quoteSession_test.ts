// Pure-unit tests for the canonical Quote Session helpers. No DB.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeFields,
  computeRequired,
  nextQuestion,
  isReadyToPrice,
  isReadyToBook,
  normalizeEmail,
  normalizePhone,
  fieldsFromFacts,
  type QuoteSession,
} from "./quoteSession.ts";

const empty = (): QuoteSession => ({
  id: "s1",
  channel: "voice",
  conversationIds: [],
  fields: {},
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "none",
  bookingReady: false,
});

Deno.test("mergeFields: first non-empty value captures the field", () => {
  const s = mergeFields(empty(), { squareFootage: 2000 });
  assertEquals(s.fields.squareFootage, 2000);
  assertEquals(s.fieldStatus.squareFootage, "captured");
});

Deno.test("mergeFields: changing a captured value marks it corrected", () => {
  let s = mergeFields(empty(), { squareFootage: 2000 });
  s = mergeFields(s, { squareFootage: 2400 });
  assertEquals(s.fields.squareFootage, 2400);
  assertEquals(s.fieldStatus.squareFootage, "corrected");
});

Deno.test("mergeFields: empty values do not overwrite existing captured values", () => {
  let s = mergeFields(empty(), { name: "Ada" });
  s = mergeFields(s, { name: "" });
  assertEquals(s.fields.name, "Ada");
});

Deno.test("computeRequired: services first, then property inputs", () => {
  assertEquals(computeRequired({}), ["services"]);
  assertEquals(computeRequired({ services: ["windowCleaning"] }), [
    "squareFootage",
    "stories",
    "windowCleaningType",
  ]);
});

Deno.test("isReadyToPrice: window cleaning ready with sqft + stories + type", () => {
  assert(
    isReadyToPrice({
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningType: "exterior",
    }),
  );
});

Deno.test("nextQuestion: picks the highest-priority missing field", () => {
  const s: QuoteSession = { ...empty(), fields: { services: ["windowCleaning"], stories: 2 } };
  const plan = nextQuestion(s);
  assertEquals(plan.nextField, "squareFootage");
  assertEquals(plan.readyToPrice, false);
});

Deno.test("nextQuestion: ready to price when all inputs present, next asks for city/address", () => {
  const s: QuoteSession = {
    ...empty(),
    quoteStatus: "estimated",
    fields: {
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningType: "exterior",
    },
  };
  const plan = nextQuestion(s);
  assertEquals(plan.readyToPrice, true);
  // Priced but not booking-ready without address/email.
  assertEquals(plan.readyToBook, false);
});

Deno.test("isReadyToBook: needs address + email + estimated/firm quote", () => {
  const priced: QuoteSession = {
    ...empty(),
    quoteStatus: "estimated",
    fields: { services: ["windowCleaning"], squareFootage: 2000 },
  };
  assertEquals(isReadyToBook(priced), false);
  const readied: QuoteSession = {
    ...priced,
    fields: { ...priced.fields, address: "123 Main St", email: "a@b.co" },
  };
  assertEquals(isReadyToBook(readied), true);
});

Deno.test("normalize helpers", () => {
  assertEquals(normalizeEmail("  Foo@Bar.CO "), "foo@bar.co");
  assertEquals(normalizeEmail(null), null);
  assertEquals(normalizePhone("(469) 555-1234"), "+14695551234");
  assertEquals(normalizePhone("14695551234"), "+14695551234");
  assertEquals(normalizePhone(""), null);
});

Deno.test("fieldsFromFacts: maps ConversationFacts to the canonical shape", () => {
  const f = fieldsFromFacts({
    services: ["windowCleaning"],
    address: "1 Main",
    property: { squareFootage: 2000, stories: 2, windowCleaningType: "exterior" },
    contact: { name: "Ada", email: "a@b.co" },
    roughQuote: { city: "McKinney" },
  } as any);
  assertEquals(f.services, ["windowCleaning"]);
  assertEquals(f.squareFootage, 2000);
  assertEquals(f.windowCleaningType, "exterior");
  assertEquals(f.city, "McKinney");
  assertEquals(f.name, "Ada");
});

Deno.test("Regression: correcting one field does not clear unrelated fields", () => {
  let s = mergeFields(empty(), { services: ["windowCleaning"], squareFootage: 2000, stories: 2 });
  s = mergeFields(s, { squareFootage: 2400 });
  assertEquals(s.fields.stories, 2);
  assertEquals(s.fields.services, ["windowCleaning"]);
  assertEquals(s.fieldStatus.squareFootage, "corrected");
  assertEquals(s.fieldStatus.stories, "captured");
});
