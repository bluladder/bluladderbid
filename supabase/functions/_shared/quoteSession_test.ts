// Pure-unit tests for the canonical Quote Session helpers. No DB.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeFields,
  computeRequired,
  nextQuestion,
  isReadyToPrice,
  isReadyToBook,
  sessionInputsKey,
  normalizeEmail,
  normalizePhone,
  fieldsFromFacts,
  changeWindowScope,
  addCommercialLocation,
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

Deno.test("field provenance keeps defaulted distinct from verified", () => {
  const s = mergeFields(empty(), { stories: 1 }, { markDefaulted: ["stories"] });
  assertEquals(s.fieldStatus.stories, "defaulted");
  assert(s.fieldStatus.stories !== "verified");
});

Deno.test("screen profile provenance is derived and cannot be asserted independently", () => {
  let s = mergeFields(empty(), { screenProfile: "no_screens" }, { markDefaulted: ["screenProfile"] });
  assertEquals(s.fields.screenProfileProvenance, "defaulted");
  s = mergeFields(s, { screenProfileProvenance: "verified" });
  assertEquals(s.fields.screenProfileProvenance, "defaulted");
  s = mergeFields(s, { screenProfile: "standard_removable" }, { markVerified: ["screenProfile"] });
  assertEquals(s.fields.screenProfileProvenance, "verified");
});

Deno.test("screen-profile provenance participates in the canonical input hash", () => {
  const base = { services:["windowCleaning"], screenProfile:"no_screens" as const };
  assert(sessionInputsKey({ ...base, screenProfileProvenance:"captured" }) !== sessionInputsKey({ ...base, screenProfileProvenance:"defaulted" }));
});

Deno.test("legacy windowCleaningType normalizes to the sole writable sides field", () => {
  const s = mergeFields(empty(), { windowCleaningType: "both" });
  assertEquals(s.fields.windowCleaningSides, "inside_and_outside");
  assertEquals(s.fields.windowCleaningType, undefined);
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
    "windowCleaningSides",
    "condition",
    "advancedWindowConditions",
    "screenProfile",
    "enclosedPatioProfile",
  ]);
});

Deno.test("isReadyToPrice: window cleaning ready with sqft + stories + type", () => {
  assert(
    isReadyToPrice({
      services: ["windowCleaning"],
      squareFootage: 2000,
      stories: 2,
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
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
      windowCleaningSides: "outside_only",
      condition: "maintenance",
      advancedWindowConditions: false,
      screenProfile: "standard_removable",
      enclosedPatioProfile: "none",
    },
  };
  const plan = nextQuestion(s);
  assertEquals(plan.readyToPrice, true);
  // Priced but not booking-ready without address/email.
  assertEquals(plan.readyToBook, false);
});

Deno.test("isReadyToBook: needs complete intake, address, email, and authoritative duration", () => {
  const priced: QuoteSession = {
    ...empty(),
    quoteStatus: "estimated",
    fields: { services: ["houseWash"], squareFootage: 2000, stories: 1, enclosedPatioProfile: "none" },
  };
  assertEquals(isReadyToBook(priced), false);
  const readied: QuoteSession = {
    ...priced,
    fields: {
      ...priced.fields,
      address: "123 Main St",
      email: "a@b.co",
      serviceAreaStatus: "eligible",
      lastQuoteResult: { status:"estimated", estimatedDurationMinutes:90 },
    },
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
  assertEquals(f.windowCleaningSides, "outside_only");
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

// -------- Phase 4C-β.4A additions --------

Deno.test("computeRequired: partial-window request needs count + sides, never sqft", () => {
  const missing = computeRequired({
    services: ["windowCleaning"],
    windowCleaningScope: "partial",
  });
  assert(missing.includes("windowCount"));
  assert(missing.includes("windowCleaningSides"));
  assert(!missing.includes("squareFootage"));
});

Deno.test("computeRequired: unit and area services never inherit home fields", () => {
  assertEquals(computeRequired({ services: ["solarPanelCleaning"] }), [
    "solarPanelCount",
    "solarAccessProfile",
  ]);
  assertEquals(
    computeRequired({
      services: ["solarPanelCleaning"],
      solarPanelCount: 20,
      solarAccessProfile: {
        stories: 2,
        accessType: "standard_residential",
        knownDamage: false,
        extremePitch: false,
        fragileMaterial: false,
        unusualAccess: false,
      },
    }),
    [],
  );
  assertEquals(computeRequired({ services: ["screenRepair"] }), ["screenRepairCount"]);
  assertEquals(computeRequired({ services: ["drivewayCleaning"] }), ["drivewaySqft", "drivewaySurface"]);
  const multi = computeRequired({ services: ["drivewayCleaning", "screenRepair"] });
  assertEquals(multi.sort(), ["drivewaySqft", "drivewaySurface", "screenRepairCount"].sort());
});

Deno.test("computeRequired: commercial custom bid asks for locations + contact method, not sqft", () => {
  const missing = computeRequired({
    services: ["windowCleaning"],
    windowCleaningScope: "commercial_custom",
    customerType: "commercial",
  });
  assert(missing.includes("commercialLocations"));
  assert(missing.includes("preferredContactMethods"));
  assert(!missing.includes("squareFootage"));
});

Deno.test("changeWindowScope: whole_home → partial preserves address/contact/notes", () => {
  let s = mergeFields(empty(), {
    services: ["windowCleaning"],
    address: "123 Main St",
    email: "a@b.co",
    name: "Ada",
    squareFootage: 2400,
    windowCleaningType: "exterior",
    windowCleaningScope: "whole_home",
  });
  s = changeWindowScope(s, "partial");
  assertEquals(s.fields.address, "123 Main St");
  assertEquals(s.fields.email, "a@b.co");
  assertEquals(s.fields.name, "Ada");
  // Whole-home-dependent pricing fields invalidated
  assertEquals(s.fields.squareFootage, undefined);
  assertEquals(s.fields.windowCleaningType, undefined);
  assertEquals(s.fields.windowCleaningScope, "partial");
});

Deno.test("changeWindowScope: partial → whole_home invalidates partial pricing only", () => {
  let s = mergeFields(empty(), {
    services: ["windowCleaning"],
    address: "1 Elm",
    windowCleaningScope: "partial",
    windowCount: 5,
    partialWindowPrice: 50,
    partialAreas: ["front"],
  });
  s = changeWindowScope(s, "whole_home");
  assertEquals(s.fields.address, "1 Elm");
  assertEquals(s.fields.windowCount, undefined);
  assertEquals(s.fields.partialWindowPrice, undefined);
  assertEquals(s.fields.partialAreas, undefined);
  assertEquals(s.fields.windowCleaningScope, "whole_home");
});

Deno.test("addCommercialLocation: multiple locations persist distinctly", () => {
  let s = empty();
  s = addCommercialLocation(s, { address: "100 Main St, McKinney", sides: "outside_only" });
  s = addCommercialLocation(s, { address: "200 Oak Ave, Frisco", sides: "outside_only" });
  assertEquals(s.fields.commercialLocations?.length, 2);
  // Repeat location merges rather than duplicating
  s = addCommercialLocation(s, { address: "100 Main St, McKinney", stories: 2 });
  assertEquals(s.fields.commercialLocations?.length, 2);
  assertEquals(s.fields.commercialLocations?.[0].stories, 2);
});

Deno.test("nextQuestion: partial request routes to windowCount before other fields", () => {
  const s: QuoteSession = {
    ...empty(),
    fields: { services: ["windowCleaning"], windowCleaningScope: "partial" },
  };
  assertEquals(nextQuestion(s).nextField, "windowCount");
});

Deno.test("nextQuestion: selected add-on requirements never dead-end question selection", () => {
  const gutter: QuoteSession = {
    ...empty(),
    fields: {
      services: ["gutterCleaning"],
      squareFootage: 2000,
      stories: 1,
      gutterAddons: { undergroundDrains: { enabled: true } },
    },
  };
  assertEquals(nextQuestion(gutter).nextField, "gutterUndergroundDrainCount");

  const patio: QuoteSession = {
    ...empty(),
    fields: {
      services: ["houseWash"],
      squareFootage: 2000,
      stories: 1,
      enclosedPatioProfile: "none",
      houseWashPatios: { frontSelected: true },
    },
  };
  assertEquals(nextQuestion(patio).nextField, "houseWashPatioPricingMethod");
});
