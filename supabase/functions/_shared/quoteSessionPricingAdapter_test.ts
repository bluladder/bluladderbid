import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { quoteSessionFieldsToQuoteInput } from "./quoteSessionPricingAdapter.ts";
import {
  mergeFields,
  type QuoteSession,
  type QuoteSessionFields,
  sessionBookingInputsKey,
  sessionInputsKey,
} from "./quoteSession.ts";

const session = (fields: QuoteSessionFields): QuoteSession => ({
  id: "session-1",
  channel: "voice",
  conversationIds: ["conversation-1"],
  fields,
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "firm",
  bookingReady: true,
  lastStep: "priced_spoken",
});

Deno.test("canonical pricing adapter covers service-specific inputs without unrelated defaults", () => {
  const cases: Array<{
    name: string;
    fields: QuoteSessionFields;
    assertInput: (
      input: ReturnType<typeof quoteSessionFieldsToQuoteInput>,
    ) => void;
  }> = [
    {
      name: "solar only",
      fields: { services: ["solarPanelCleaning"], solarPanelCount: 18 },
      assertInput: (input) => {
        assertEquals(
          input.additionalServices.solarPanelCleaning?.panelCount,
          18,
        );
        assert(Number.isNaN(input.homeDetails.squareFootage));
        assertEquals(input.additionalServices.windowCleaning, false);
      },
    },
    {
      name: "screen repair only",
      fields: { services: ["screenRepair"], screenRepairCount: 4 },
      assertInput: (input) => {
        assertEquals(input.additionalServices.screenRepair?.screenCount, 4);
        assert(Number.isNaN(input.homeDetails.stories));
      },
    },
    {
      name: "driveway",
      fields: {
        services: ["drivewayCleaning"],
        drivewaySqft: 900,
        drivewaySurface: "pavers",
      },
      assertInput: (input) => {
        assertEquals(input.additionalServices.drivewayCleaning, {
          enabled: true,
          sqft: 900,
          surfaceType: "pavers",
        });
        assert(Number.isNaN(input.homeDetails.squareFootage));
      },
    },
    {
      name: "named pressure-washing areas",
      fields: {
        services: ["pressureWashing"],
        pressureWashSurface: "concrete",
        pressureWashingAreas: {
          frontPorch: { enabled: true, sqft: 80, surfaceType: "concrete" },
          walkways: { enabled: true, sqft: 120, surfaceType: "concrete" },
        },
      },
      assertInput: (input) => {
        assertEquals(
          input.additionalServices.pressureWashing?.frontPorch.sqft,
          80,
        );
        assertEquals(
          input.additionalServices.pressureWashing?.walkways.sqft,
          120,
        );
        assert(
          Number.isNaN(
            input.additionalServices.pressureWashing?.backPatio.sqft,
          ),
        );
      },
    },
    {
      name: "gutter add-ons and house-wash patios",
      fields: {
        services: ["gutterCleaning", "houseWash"],
        squareFootage: 2400,
        stories: 2,
        gutterAddons: {
          undergroundDrains: { enabled: true, count: 3 },
          minorRepairs: true,
        },
        houseWashPatios: {
          pricingMethod: "exact_square_footage",
          frontSelected: true,
          frontSqft: 140,
        },
      },
      assertInput: (input) => {
        assertEquals(
          input.additionalServices.gutterAddons?.undergroundDrains?.count,
          3,
        );
        assertEquals(input.additionalServices.houseWashPatios?.frontSqft, 140);
      },
    },
  ];
  for (const testCase of cases) {
    testCase.assertInput(quoteSessionFieldsToQuoteInput(testCase.fields));
  }
});

Deno.test("promotion is explicit and never gets a made-up window count", () => {
  const missingCount = quoteSessionFieldsToQuoteInput({
    services: ["windowCleaning"],
    promotionId: "configured-promo",
  });
  assertEquals(missingCount.promotion, null);
  const complete = quoteSessionFieldsToQuoteInput({
    services: ["windowCleaning"],
    promotionId: "configured-promo",
    windowCount: 14,
  });
  assertEquals(complete.promotion, { id: "configured-promo", windowCount: 14 });
});

Deno.test("every representative price-changing correction changes the canonical input key", () => {
  const base: QuoteSessionFields = {
    services: ["windowCleaning", "gutterCleaning"],
    squareFootage: 2200,
    stories: 2,
    windowCleaningSides: "outside_only",
    condition: "maintenance",
    advancedWindowConditions: false,
    screenProfile: "standard_removable",
    enclosedPatioProfile: "none",
    gutterAddons: { undergroundDrains: { enabled: true, count: 1 } },
  };
  const variants: QuoteSessionFields[] = [
    { ...base, squareFootage: 2600 },
    { ...base, windowCleaningSides: "inside_and_outside" },
    {
      ...base,
      gutterAddons: { undergroundDrains: { enabled: true, count: 2 } },
    },
    {
      ...base,
      screenProfile: "no_screens",
      screenProfileProvenance: "captured",
    },
    {
      ...base,
      enclosedPatioProfile: "screened",
      screenedEnclosureSoftWash: true,
    },
  ];
  for (const variant of variants) {
    assertNotEquals(sessionInputsKey(base), sessionInputsKey(variant));
  }
});

Deno.test("price correction clears quote, acceptance, delivery, availability and booking", () => {
  const before = session({
    services: ["drivewayCleaning"],
    drivewaySqft: 800,
    drivewaySurface: "concrete",
    lastQuoteResult: { status: "firm", total: 160, inputsKey: "old" },
    voiceJourney: {
      intent: "new_quote",
      quoteContext: { inputsKey: "old", acceptedAt: "2026-08-01T00:00:00Z" },
      delivery: { channel: "sms", status: "provider_accepted" },
      availability: { status: "offered", offeredSlotIds: ["slot_1"] },
      booking: { status: "confirmation_required" },
    },
  });
  const next = mergeFields(before, { drivewaySqft: 900 });
  assertEquals(next.quoteStatus, "none");
  assertEquals(next.bookingReady, false);
  assertEquals(next.fields.lastQuoteResult, undefined);
  assertEquals(next.fields.voiceJourney?.quoteContext, null);
  assertEquals(next.fields.voiceJourney?.delivery, null);
  assertEquals(next.fields.voiceJourney?.availability, null);
  assertEquals(next.fields.voiceJourney?.booking?.status, "not_started");
});

Deno.test("contact correction preserves price but invalidates booking context", () => {
  const fields: QuoteSessionFields = {
    services: ["screenRepair"],
    screenRepairCount: 3,
    email: "old@example.com",
    lastQuoteResult: { status: "firm", total: 120 },
    voiceJourney: {
      quoteContext: { inputsKey: "price-key" },
      availability: { status: "offered", offeredSlotIds: ["slot_1"] },
      booking: { status: "confirmation_required" },
    },
  };
  const before = session(fields);
  const priceKey = sessionInputsKey(before.fields);
  const bookingKey = sessionBookingInputsKey(before.fields);
  const next = mergeFields(before, { email: "new@example.com" });
  assertEquals(sessionInputsKey(next.fields), priceKey);
  assertNotEquals(sessionBookingInputsKey(next.fields), bookingKey);
  assert(next.fields.lastQuoteResult);
  assert(next.fields.voiceJourney?.quoteContext);
  assertEquals(next.fields.voiceJourney?.availability, null);
});

Deno.test("canonical fingerprint ignores stale fields from an unselected service", () => {
  const screenOnly: QuoteSessionFields = {
    services: ["screenRepair"],
    screenRepairCount: 3,
    screenRepairScopeType: "standard_removable_reusable_frame",
  };
  assertEquals(
    sessionInputsKey(screenOnly),
    sessionInputsKey({
      ...screenOnly,
      // A retained value from an earlier driveway selection is not an input
      // to the currently selected screen-repair service.
      drivewaySqft: 900,
      drivewaySurface: "concrete",
    }),
  );
});

Deno.test("removing a service clears only fields not shared by retained services", () => {
  const before = session({
    services: ["windowCleaning", "houseWash"],
    squareFootage: 2400,
    stories: 2,
    windowCleaningScope: "whole_home",
    windowCleaningSides: "outside_only",
    condition: "maintenance",
    advancedWindowConditions: false,
    screenProfile: "standard_removable",
    enclosedPatioProfile: "none",
  });
  const next = mergeFields(before, { services: ["houseWash"] });
  assertEquals(next.fields.squareFootage, 2400);
  assertEquals(next.fields.stories, 2);
  assertEquals(next.fields.enclosedPatioProfile, "none");
  assertEquals(next.fields.windowCleaningSides, undefined);
  assertEquals(next.fields.windowCleaningScope, undefined);
  assertEquals(next.fields.condition, undefined);
  assertEquals(next.fields.screenProfile, undefined);
});

Deno.test("removing a service never mutates nested fields on the previous session", () => {
  const before = session({
    services: ["gutterCleaning", "houseWash"],
    squareFootage: 2400,
    stories: 2,
    gutterAddons: {
      undergroundDrains: { enabled: true, count: 3 },
      minorRepairs: true,
    },
  });

  const next = mergeFields(before, { services: ["houseWash"] });

  assertEquals(before.fields.gutterAddons, {
    undergroundDrains: { enabled: true, count: 3 },
    minorRepairs: true,
  });
  assertEquals(next.fields.gutterAddons, undefined);
});
