import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { QuoteSession } from "../quoteSession.ts";
import {
  applyApprovedWindowDefaults,
  applyVolunteeredVoiceFacts,
  classifyContextualVoiceQuoteByTextRejection,
  classifyContextualVoiceQuoteByTextRequest,
  hasVolunteeredDiscountCodeCue,
  isOperationalInstructionClause,
  isProviderRecordingNotice,
  nextExpressPrePriceField,
  normalizeVolunteeredDiscountCode,
  splitVoiceClauses,
} from "./voicePolicy.ts";

function session(fields: QuoteSession["fields"] = {}): QuoteSession {
  return {
    id: "voice-policy-test",
    organizationId: "org-test",
    channel: "voice",
    conversationIds: ["conversation-test"],
    fields,
    fieldStatus: {},
    requiredRemaining: [],
    quoteStatus: "none",
    bookingReady: false,
  };
}

Deno.test("recording notice is recognized without matching customer speech", () => {
  assertEquals(isProviderRecordingNotice("This call will be recorded."), true);
  assertEquals(
    isProviderRecordingNotice(
      "This call may be recorded for quality assurance",
    ),
    true,
  );
  assertFalse(isProviderRecordingNotice("I need outside window cleaning."));
});

Deno.test("volunteered services merge instead of erasing prior selections", () => {
  const initial = session({ services: ["house_wash"] });
  const next = applyVolunteeredVoiceFacts(
    initial,
    "I also need outside window cleaning.",
  );
  assertEquals(next.fields.services, ["house_wash", "window_cleaning"]);
  assertEquals(next.fields.windowCleaningSides, "outside_only");
});

Deno.test("compound answer keeps square footage separate from ladder count", () => {
  const next = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "It is 2,000 square feet, outside only, and two windows need unusual ladder access.",
  );
  assertEquals(next.fields.squareFootage, 2000);
  assertEquals(next.fields.windowCleaningSides, "outside_only");
  assertEquals(next.fields.ladderWork, true);
  assertEquals(next.fields.ladderAffectedWindowEquivalents, 2);
});

Deno.test("inside and outside is not downgraded to outside only", () => {
  const next = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "I want the windows cleaned inside and outside.",
  );
  assertEquals(next.fields.windowCleaningSides, "inside_and_outside");
});

Deno.test("approved window defaults retain default provenance", () => {
  const next = applyApprovedWindowDefaults(
    session({ services: ["window_cleaning"] }),
  );
  assertEquals(next.fields.stories, 1);
  assertEquals(next.fields.condition, "maintenance");
  assertEquals(next.fields.screenProfile, "standard_removable");
  assertEquals(
    next.fields.answerProvenance?.stories,
    "approved_business_default",
  );
  assertEquals(
    next.fields.answerProvenance?.condition,
    "approved_business_default",
  );
  assertEquals(next.fields.voiceJourney?.policyVersion, "voice-express-v1");
});

Deno.test("express path asks only true pricing gaps", () => {
  const initial = applyApprovedWindowDefaults(
    session({ services: ["window_cleaning"] }),
  );
  assertEquals(nextExpressPrePriceField(initial), "squareFootage");
  const withSqft = applyVolunteeredVoiceFacts(
    initial,
    "The home is 2,000 square feet.",
  );
  assertEquals(nextExpressPrePriceField(withSqft), "windowCleaningSides");
  const complete = applyVolunteeredVoiceFacts(withSqft, "Outside only.");
  assertEquals(nextExpressPrePriceField(complete), null);
});

Deno.test("volunteered discount codes normalize without asking proactively", () => {
  assertEquals(
    normalizeVolunteeredDiscountCode("My coupon code is blue50"),
    "BLUE50",
  );
  assertEquals(
    normalizeVolunteeredDiscountCode("I do not have a coupon"),
    null,
  );
});

Deno.test("phase3 outside quote captures sides and next asks only square footage", () => {
  const volunteered = applyVolunteeredVoiceFacts(
    session(),
    "I need a quote for outside window cleaning.",
  );
  const next = applyApprovedWindowDefaults(volunteered);
  assertEquals(next.fields.voiceJourney?.intent, undefined);
  assertEquals(next.fields.services, ["window_cleaning"]);
  assertEquals(next.fields.windowCleaningSides, "outside_only");
  assertEquals(nextExpressPrePriceField(next), "squareFootage");
});

Deno.test("phase3 sides are asked once and not repeated after capture", () => {
  const initial = applyApprovedWindowDefaults(
    session({ services: ["window_cleaning"], squareFootage: 2000 }),
  );
  assertEquals(nextExpressPrePriceField(initial), "windowCleaningSides");
  const captured = applyVolunteeredVoiceFacts(initial, "All exterior windows.");
  assertEquals(captured.fields.windowCleaningSides, "outside_only");
  assertEquals(nextExpressPrePriceField(captured), null);
});

Deno.test("phase3 approved defaults cover ordinary whole-home windows and explicit overrides win", () => {
  const defaulted = applyApprovedWindowDefaults(
    session({ services: ["window_cleaning"], hardWaterStains: true }),
  );
  const expected = {
    customerType: "residential",
    windowCleaningScope: "whole_home",
    stories: 1,
    condition: "maintenance",
    screenProfile: "standard_removable",
    frenchPanes: false,
    ladderWork: false,
    enclosedPatioProfile: "none",
  } as const;
  const fields = defaulted.fields as Record<string, unknown>;
  const statuses = defaulted.fieldStatus as Record<string, unknown>;
  for (const [field, value] of Object.entries(expected)) {
    assertEquals(fields[field], value);
    assertEquals(statuses[field], "defaulted");
    assertEquals(
      defaulted.fields.answerProvenance?.[field],
      "approved_business_default",
    );
  }
  assertEquals(defaulted.fields.hardWaterStains, true);
  assertEquals(defaulted.fields.advancedWindowConditions, true);
  assertEquals(defaulted.fieldStatus.advancedWindowConditions, "derived");
  assertEquals(
    defaulted.fields.answerProvenance?.advancedWindowConditions ===
      "approved_business_default",
    false,
  );
  assertEquals(defaulted.fieldStatus.hardWaterStains, undefined);
});

Deno.test("phase3 no-comma square footage plus ladder quantity parses modifier-local count", () => {
  const next = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "about 2,000 square feet and ladder work on two windows",
  );
  assertEquals(next.fields.squareFootage, 2000);
  assertEquals(next.fields.ladderWork, true);
  assertEquals(next.fields.ladderAffectedWindowEquivalents, 2);
});

Deno.test("phase3 modifier-local ladder counts accept both word orders", () => {
  const before = session({ services: ["window_cleaning"] });
  const beforeKeyword = applyVolunteeredVoiceFacts(
    before,
    "two windows need unusual ladder access",
  );
  const afterKeyword = applyVolunteeredVoiceFacts(
    before,
    "ladder work on two windows",
  );
  assertEquals(beforeKeyword.fields.ladderWork, true);
  assertEquals(beforeKeyword.fields.advancedWindowConditions, true);
  assertEquals(beforeKeyword.fields.ladderAffectedWindowEquivalents, 2);
  assertEquals(afterKeyword.fields.ladderAffectedWindowEquivalents, 2);
});

Deno.test("phase3 negation-aware explicit modifiers override defaults safely", () => {
  const next = applyApprovedWindowDefaults(applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "regular maintenance, no hard water, no ladder work, no solar screens, no French panes, no patio",
  ));
  assertEquals(next.fields.hardWaterStains, false);
  assertEquals(next.fields.ladderWork, false);
  assertEquals(next.fields.screenProfile, "standard_removable");
  assertEquals(next.fields.frenchPanes, false);
  assertEquals(next.fields.condition, "maintenance");
  assertEquals(next.fields.enclosedPatioProfile, "none");
  assertEquals(next.fieldStatus.hardWaterStains, "captured");
  assertEquals(
    next.fields.answerProvenance?.hardWaterStains,
    "explicitly_selected",
  );
});

Deno.test("phase3 positive modifiers set advanced conditions and screen/patio phrases stay precise", () => {
  const positive = applyApprovedWindowDefaults(applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "heavy condition with French panes and ladder access on two windows, no solar screens, window-enclosed patio",
  ));
  assertEquals(positive.fields.condition, "heavy");
  assertEquals(positive.fields.frenchPanes, true);
  assertEquals(positive.fields.ladderWork, true);
  assertEquals(positive.fields.ladderAffectedWindowEquivalents, 2);
  assertEquals(positive.fields.advancedWindowConditions, true);
  assertEquals(positive.fields.screenProfile, "standard_removable");
  assertEquals(positive.fields.enclosedPatioProfile, "window_enclosed");
  const ambiguous = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "there is an enclosed patio",
  );
  assertEquals(ambiguous.fields.enclosedPatioProfile, "mixed_or_uncertain");
});

Deno.test("phase3 commercial and partial window requests do not receive ordinary defaults", () => {
  const commercial = applyApprovedWindowDefaults(applyVolunteeredVoiceFacts(
    session(),
    "I need a quote for commercial storefront window cleaning",
  ));
  assertEquals(commercial.fields.customerType, "commercial");
  assertEquals(commercial.fields.windowCleaningScope, "commercial_custom");
  assertEquals(commercial.fields.condition, undefined);
  const partial = applyApprovedWindowDefaults(applyVolunteeredVoiceFacts(
    session(),
    "I need only the five front windows cleaned",
  ));
  assertEquals(partial.fields.windowCleaningScope, "partial");
  assertEquals(partial.fields.condition, undefined);
});

Deno.test("phase3 service and side extraction is explicit and negation safe", () => {
  const noHouse = applyVolunteeredVoiceFacts(
    session(),
    "outside window cleaning, no house washing",
  );
  assertEquals(noHouse.fields.services, ["window_cleaning"]);
  assertEquals(noHouse.fields.windowCleaningSides, "outside_only");
  const noGutters = applyVolunteeredVoiceFacts(
    session(),
    "window cleaning, not gutters",
  );
  assertEquals(noGutters.fields.services, ["window_cleaning"]);
  const note = applyVolunteeredVoiceFacts(
    session(),
    "the dog stays outside and park outside the gate",
  );
  assertEquals(note.fields.windowCleaningSides, undefined);
  const ladderNote = applyVolunteeredVoiceFacts(
    session(),
    "our ladder is behind the gate",
  );
  assertEquals(ladderNote.fields.ladderWork, undefined);
});

Deno.test("phase3 operational notes are inert except volunteeredNotes", () => {
  const before = applyApprovedWindowDefaults(session({
    services: ["window_cleaning"],
    squareFootage: 2000,
    windowCleaningSides: "outside_only",
  }));
  const after = applyVolunteeredVoiceFacts(
    before,
    "Please text before arrival because the dog and gate are tricky.",
  );
  assertEquals(after.fields.services, before.fields.services);
  assertEquals(after.fields.squareFootage, before.fields.squareFootage);
  assertEquals(
    after.fields.windowCleaningSides,
    before.fields.windowCleaningSides,
  );
  assertEquals(after.fields.discountCode, before.fields.discountCode);
  assertEquals(after.fields.address, before.fields.address);
  assertEquals(
    after.fields.voiceJourney?.availability,
    before.fields.voiceJourney?.availability,
  );
  assertEquals(
    after.fields.voiceJourney?.booking,
    before.fields.voiceJourney?.booking,
  );
  assertEquals(after.fields.voiceJourney?.volunteeredNotes?.length, 1);
});

Deno.test("phase3 operational note clauses do not change pre-price quote facts", () => {
  const base = session({ services: ["window_cleaning"] });
  for (
    const utterance of [
      "2,000 square feet; dog stays outside by the gate",
      "2,000 square feet; that is a heavy gate",
      "2,000 square feet; use the selected parking area",
      "2,000 square feet; our ladder is by the gate",
    ]
  ) {
    const next = applyVolunteeredVoiceFacts(base, utterance);
    assertEquals(next.fields.squareFootage, 2000);
    assertEquals(next.fields.windowCleaningSides, undefined);
    assertEquals(next.fields.condition, undefined);
    assertEquals(next.fields.windowCleaningScope, undefined);
    assertEquals(next.fields.ladderWork, undefined);
    assertEquals(next.fields.voiceJourney?.volunteeredNotes?.length, 1);
  }
});

Deno.test("phase3 real quote clauses still capture beside separate operational notes", () => {
  const next = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "2,000 square feet, outside only; dog stays outside by the gate",
  );
  assertEquals(next.fields.squareFootage, 2000);
  assertEquals(next.fields.windowCleaningSides, "outside_only");
  assertEquals(next.fields.voiceJourney?.volunteeredNotes?.length, 1);
});

Deno.test("phase3 unusual ladder access is a priced modifier but gate ladder notes are inert", () => {
  const priced = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "two windows need unusual ladder access",
  );
  assertEquals(priced.fields.ladderWork, true);
  assertEquals(priced.fields.advancedWindowConditions, true);
  assertEquals(priced.fields.ladderAffectedWindowEquivalents, 2);
  const note = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "our ladder is by the gate",
  );
  assertEquals(note.fields.ladderWork, undefined);
  assertEquals(note.fields.advancedWindowConditions, undefined);
});

Deno.test("phase3 negation-safe service extraction keeps only explicitly wanted services", () => {
  for (
    const utterance of [
      "I don't need house washing, just outside window cleaning",
      "do not want house washing, just window cleaning",
      "Do not add gutter cleaning; I only want window cleaning",
      "I am not asking for roof cleaning, just windows",
    ]
  ) {
    const next = applyVolunteeredVoiceFacts(session(), utterance);
    assertEquals(next.fields.services, ["window_cleaning"]);
    assertEquals(
      JSON.stringify(next.fields).includes("houseWashWindowBundle"),
      false,
    );
  }
});

Deno.test("phase3 negative unusual ladder access stays negative", () => {
  for (
    const utterance of [
      "no unusual ladder access",
      "not unusual ladder access",
      "without unusual ladder access",
    ]
  ) {
    const next = applyVolunteeredVoiceFacts(
      session({ services: ["window_cleaning"] }),
      utterance,
    );
    assertEquals(next.fields.ladderWork, false);
    assertEquals(next.fields.advancedWindowConditions, undefined);
  }
});

Deno.test("phase3 approved defaults apply only to window-only ordinary quotes", () => {
  const mixed = applyApprovedWindowDefaults(session({
    services: ["window_cleaning", "house_wash"],
  }));
  assertEquals(mixed.fields.stories, undefined);
  assertEquals(mixed.fields.condition, undefined);
  assertEquals(mixed.fields.answerProvenance?.stories, undefined);
});

Deno.test("phase3 contextual quote-by-text classifier is strict and note-safe", () => {
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("please text me the quote"),
    true,
  );
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("send that to me"),
    true,
  );
  assertEquals(classifyContextualVoiceQuoteByTextRequest("text me"), false);
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("text me before arrival"),
    false,
  );
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest(
      "message me when you are on the way",
    ),
    false,
  );
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("send the parking instructions"),
    false,
  );
});

Deno.test("phase3 negated modifiers clear stale counts without clearing other positives", () => {
  const initial = session({
    services: ["window_cleaning"],
    ladderWork: true,
    ladderAffectedWindowEquivalents: 3,
    hardWaterStains: true,
    hardWaterAffectedWindowEquivalents: 2,
    advancedWindowConditions: true,
  });
  initial.fieldStatus = {
    ladderAffectedWindowEquivalents: "captured",
    hardWaterAffectedWindowEquivalents: "captured",
  };
  initial.fields.answerProvenance = {
    ladderAffectedWindowEquivalents: "explicitly_selected",
    hardWaterAffectedWindowEquivalents: "explicitly_selected",
  };
  const next = applyVolunteeredVoiceFacts(initial, "no unusual ladder access");
  assertEquals(next.fields.ladderWork, false);
  assertEquals(next.fields.ladderAffectedWindowEquivalents, undefined);
  assertEquals(next.fieldStatus.ladderAffectedWindowEquivalents, undefined);
  assertEquals(
    next.fields.answerProvenance?.ladderAffectedWindowEquivalents,
    undefined,
  );
  assertEquals(next.fields.hardWaterStains, true);
  assertEquals(next.fields.hardWaterAffectedWindowEquivalents, 2);
  assertEquals(next.fields.advancedWindowConditions, true);
});

Deno.test("phase3 positive then negative unusual ladder access corrects advanced state", () => {
  const positive = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "two windows need unusual ladder access",
  );
  assertEquals(positive.fields.ladderWork, true);
  assertEquals(positive.fields.ladderAffectedWindowEquivalents, 2);
  assertEquals(positive.fields.advancedWindowConditions, true);
  const negative = applyVolunteeredVoiceFacts(
    positive,
    "without unusual ladder access",
  );
  assertEquals(negative.fields.ladderWork, false);
  assertEquals(negative.fields.ladderAffectedWindowEquivalents, undefined);
  assertEquals(negative.fields.advancedWindowConditions, false);
});

Deno.test("phase3 unpunctuated operational tails keep pricing facts inert", () => {
  const outside = applyVolunteeredVoiceFacts(
    session(),
    "I need outside window cleaning and the dog is behind the gate",
  );
  assertEquals(outside.fields.services, ["window_cleaning"]);
  assertEquals(outside.fields.windowCleaningSides, "outside_only");
  assertEquals(outside.fields.ladderWork, undefined);
  const sqft = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "about 2,000 square feet and the pet stays outside by the gate",
  );
  assertEquals(sqft.fields.squareFootage, 2000);
  assertEquals(sqft.fields.windowCleaningSides, undefined);
  assertEquals(sqft.fields.voiceJourney?.volunteeredNotes?.length, 1);
});

Deno.test("phase3 contextual text classifier allows quote request with separate note", () => {
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest(
      "Please text me the quote; the dog is in the yard",
    ),
    true,
  );
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("text me before arrival"),
    false,
  );
  assertEquals(classifyContextualVoiceQuoteByTextRequest("text me"), false);
  assertEquals(
    classifyContextualVoiceQuoteByTextRequest("send that before arrival"),
    false,
  );
});

Deno.test("phase3 clause splitter isolates only narrow operational tails", () => {
  assertEquals(
    splitVoiceClauses(
      "inside and outside and the dog is behind the gate",
    ),
    ["inside and outside", "the dog is behind the gate"],
  );
  assertEquals(
    splitVoiceClauses(
      "hard water and ladder work on two windows and park outside the gate",
    ),
    ["hard water and ladder work on two windows", "park outside the gate"],
  );
  assertEquals(
    splitVoiceClauses("about 2,000 square feet and use the gate"),
    ["about 2,000 square feet", "use the gate"],
  );
  assertEquals(
    splitVoiceClauses(
      "about 2,000 square feet but our dog is behind the gate",
    ),
    ["about 2,000 square feet", "our dog is behind the gate"],
  );
  assertEquals(
    splitVoiceClauses("about 2,000 square feet also the pet stays outside"),
    ["about 2,000 square feet", "the pet stays outside"],
  );
  assertEquals(
    splitVoiceClauses("about 2,000 square feet then parking is outside"),
    ["about 2,000 square feet", "parking is outside"],
  );
  assertEquals(
    splitVoiceClauses("ladder work on 2, dog stays outside"),
    ["ladder work on 2", "dog stays outside"],
  );
  assertEquals(
    splitVoiceClauses(
      "about 2,000 square feet and use the selected parking area",
    ),
    ["about 2,000 square feet", "use the selected parking area"],
  );
  assertEquals(
    splitVoiceClauses("about 2,000 square feet and access is outside"),
    ["about 2,000 square feet", "access is outside"],
  );
  assertEquals(
    splitVoiceClauses("not before arrival, text the quote"),
    ["not before arrival", "text the quote"],
  );
});

Deno.test("phase3 operational classifier preserves explicit priced modifiers", () => {
  assertEquals(
    isOperationalInstructionClause("the dog is behind the gate"),
    true,
  );
  assertEquals(
    isOperationalInstructionClause("our ladder is by the gate"),
    true,
  );
  assertEquals(
    isOperationalInstructionClause(
      "two windows need unusual ladder access by the gate",
    ),
    false,
  );
  assertEquals(
    isOperationalInstructionClause("hard water on two windows by the gate"),
    false,
  );
});

Deno.test("phase3 every audited unpunctuated operational tail retains pricing facts", () => {
  const cases: Array<
    [string, "squareFootage" | "windowCleaningSides", unknown]
  > = [
    [
      "I need outside window cleaning and park outside the gate",
      "windowCleaningSides",
      "outside_only",
    ],
    [
      "about 2,000 square feet and use the parking area",
      "squareFootage",
      2000,
    ],
    ["about 2,000 square feet and use the gate", "squareFootage", 2000],
    [
      "about 2,000 square feet and the crew should use the gate",
      "squareFootage",
      2000,
    ],
    [
      "about 2,000 square feet and text before arrival",
      "squareFootage",
      2000,
    ],
  ];
  for (const [utterance, field, expected] of cases) {
    const next = applyVolunteeredVoiceFacts(
      session({ services: ["window_cleaning"] }),
      utterance,
    );
    assertEquals(next.fields[field], expected, utterance);
    assertEquals(next.fields.voiceJourney?.volunteeredNotes?.length, 1);
  }
  const modifier = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "two windows need unusual ladder access by the gate",
  );
  assertEquals(modifier.fields.ladderWork, true);
  assertEquals(modifier.fields.ladderAffectedWindowEquivalents, 2);
});

Deno.test("phase3 quote-text choice accepts exact positive echoes", () => {
  for (
    const utterance of [
      "text",
      "texted",
      "send",
      "message",
      "quote texted please",
      "I would like the quote texted",
      "have it texted",
      "text the quote",
      "send that to me and park outside the gate",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceQuoteByTextRequest(utterance),
      true,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceQuoteByTextRejection(utterance),
      false,
      utterance,
    );
  }
});

Deno.test("phase3 quote-text refusal always defeats delivery authorization", () => {
  for (
    const utterance of [
      "do not text me the quote",
      "don't send me the quote",
      "please don't text that to me",
      "no, do not message me the estimate",
      "I do not want it by text",
      "I do not want the quote texted",
      "I would not like the quote texted",
      "I said not to text the quote",
      "no quote by text",
      "Please avoid texting the quote",
      "no text",
      "not by text",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceQuoteByTextRejection(utterance),
      true,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceQuoteByTextRequest(utterance),
      false,
      utterance,
    );
  }
  for (
    const utterance of [
      "not before arrival, text the quote",
      "do not text before arrival; text the quote",
      "do not text the quote but send it to me",
      "I do not want scheduling but text the quote",
      "do not schedule and text the quote",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceQuoteByTextRejection(utterance),
      false,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceQuoteByTextRequest(utterance),
      true,
      utterance,
    );
  }
  for (const utterance of ["Did you text the quote?", "Is the quote texted?"]) {
    assertEquals(
      classifyContextualVoiceQuoteByTextRejection(utterance),
      false,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceQuoteByTextRequest(utterance),
      false,
      utterance,
    );
  }
});

Deno.test("phase3 operational messaging remains distinct from quote delivery", () => {
  for (
    const utterance of [
      "text me",
      "text me before arrival",
      "message me when you are on the way",
      "send the parking instructions",
      "send that before arrival",
    ]
  ) {
    assertEquals(
      classifyContextualVoiceQuoteByTextRequest(utterance),
      false,
      utterance,
    );
    assertEquals(
      classifyContextualVoiceQuoteByTextRejection(utterance),
      false,
      utterance,
    );
  }
});

Deno.test("phase3 bounded service negation never invents a rejected service", () => {
  for (
    const utterance of [
      "I do not currently need house washing, just window cleaning",
      "I am not presently asking for house washing, just window cleaning",
      "I no longer want house washing, just window cleaning",
      "I actually do not want house washing, just window cleaning",
      "I do not really need house washing, just window cleaning",
      "I am not interested in house washing, just window cleaning",
      "I have no need for house washing, just window cleaning",
      "I thought about house washing but no longer want house washing; just window cleaning",
      "House washing is not needed, just window cleaning",
      "no house washing or gutter cleaning, just window cleaning",
      "without roof cleaning and gutter cleaning, just window cleaning",
    ]
  ) {
    assertEquals(
      applyVolunteeredVoiceFacts(session(), utterance).fields.services,
      ["window_cleaning"],
      utterance,
    );
  }
  assertEquals(
    applyVolunteeredVoiceFacts(
      session(),
      "I actually do want house washing and window cleaning",
    ).fields.services,
    ["house_wash", "window_cleaning"],
  );
});

Deno.test("phase3 fresh negative modifiers preserve approved-default umbrella provenance", () => {
  for (
    const [utterance, field] of [
      ["no unusual ladder access", "ladderWork"],
      ["no hard water", "hardWaterStains"],
    ] as const
  ) {
    const captured = applyVolunteeredVoiceFacts(
      session({ services: ["window_cleaning"] }),
      utterance,
    );
    assertEquals(captured.fields[field], false);
    assertEquals(captured.fields.advancedWindowConditions, undefined);
    assertEquals(captured.fieldStatus.advancedWindowConditions, undefined);
    assertEquals(
      captured.fields.answerProvenance?.advancedWindowConditions,
      undefined,
    );
    const defaulted = applyApprovedWindowDefaults(captured);
    assertEquals(defaulted.fields.advancedWindowConditions, false);
    assertEquals(defaulted.fieldStatus.advancedWindowConditions, "defaulted");
    assertEquals(
      defaulted.fields.answerProvenance?.advancedWindowConditions,
      "approved_business_default",
    );
  }
});

Deno.test("phase3 legacy positive leaf clears an unset advanced umbrella", () => {
  const initial = session({
    services: ["window_cleaning"],
    hardWaterStains: true,
    hardWaterAffectedWindowEquivalents: 3,
  });
  initial.fieldStatus.hardWaterAffectedWindowEquivalents = "captured";
  initial.fields.answerProvenance = {
    hardWaterAffectedWindowEquivalents: "explicitly_selected",
  };
  const corrected = applyVolunteeredVoiceFacts(initial, "no hard water");
  assertEquals(corrected.fields.hardWaterStains, false);
  assertEquals(corrected.fields.hardWaterAffectedWindowEquivalents, undefined);
  assertEquals(corrected.fields.advancedWindowConditions, false);
  assertEquals(corrected.fieldStatus.advancedWindowConditions, "derived");
  assertEquals(
    corrected.fields.answerProvenance?.advancedWindowConditions,
    "verified_lookup",
  );
  assertEquals(
    corrected.fieldStatus.hardWaterAffectedWindowEquivalents,
    undefined,
  );
  assertEquals(
    corrected.fields.answerProvenance?.hardWaterAffectedWindowEquivalents,
    undefined,
  );
});

Deno.test("phase3 hard-water stale clearing mirrors ladder stale clearing", () => {
  const positive = applyVolunteeredVoiceFacts(
    session({ services: ["window_cleaning"] }),
    "hard water on three windows",
  );
  assertEquals(positive.fields.hardWaterStains, true);
  assertEquals(positive.fields.hardWaterAffectedWindowEquivalents, 3);
  assertEquals(positive.fields.advancedWindowConditions, true);
  assertEquals(positive.fieldStatus.advancedWindowConditions, "derived");
  assertEquals(
    positive.fields.answerProvenance?.advancedWindowConditions,
    "verified_lookup",
  );
  const negative = applyVolunteeredVoiceFacts(positive, "without hard water");
  assertEquals(negative.fields.hardWaterStains, false);
  assertEquals(negative.fields.hardWaterAffectedWindowEquivalents, undefined);
  assertEquals(negative.fields.advancedWindowConditions, false);
  assertEquals(negative.fieldStatus.advancedWindowConditions, "derived");
  assertEquals(
    negative.fields.answerProvenance?.advancedWindowConditions,
    "verified_lookup",
  );
  assertEquals(
    negative.fields.answerProvenance?.hardWaterAffectedWindowEquivalents,
    undefined,
  );
});

Deno.test("phase3 firm quote accepts only changed high-confidence pricing facts", () => {
  const firm = session({
    services: ["window_cleaning"],
    squareFootage: 2000,
    windowCleaningSides: "outside_only",
    ladderWork: true,
    ladderAffectedWindowEquivalents: 2,
    advancedWindowConditions: true,
    lastQuoteResult: { status: "firm", estimatedTotal: 200.26 },
    voiceJourney: {
      requestedNextStep: "schedule",
      quoteContext: { inputsKey: "firm-inputs", estimatedTotal: 200.26 },
    },
  });
  firm.quoteStatus = "firm";
  firm.bookingReady = true;

  const sqft = applyVolunteeredVoiceFacts(
    structuredClone(firm),
    "Actually it is 2500 square feet",
  );
  assertEquals(sqft.fields.squareFootage, 2500);
  assertEquals(sqft.quoteStatus, "none");
  assertEquals(sqft.fields.lastQuoteResult, undefined);
  assertEquals(sqft.fields.voiceJourney?.requestedNextStep, "none");

  const sides = applyVolunteeredVoiceFacts(
    structuredClone(firm),
    "Actually I need inside and outside",
  );
  assertEquals(sides.fields.windowCleaningSides, "inside_and_outside");
  assertEquals(sides.quoteStatus, "none");

  const ladder = applyVolunteeredVoiceFacts(
    structuredClone(firm),
    "Actually no unusual ladder access",
  );
  assertEquals(ladder.fields.ladderWork, false);
  assertEquals(ladder.fields.ladderAffectedWindowEquivalents, undefined);
  assertEquals(ladder.fields.advancedWindowConditions, false);
  assertEquals(ladder.quoteStatus, "none");

  const unchanged = applyVolunteeredVoiceFacts(
    structuredClone(firm),
    "It is 2000 square feet",
  );
  assertEquals(unchanged.quoteStatus, "firm");
  assertEquals(unchanged.fields.lastQuoteResult?.estimatedTotal, 200.26);
  assertEquals(unchanged.fields.voiceJourney?.requestedNextStep, "schedule");

  for (
    const utterance of [
      "meet me outside",
      "please wait outside",
      "The address is 123 Exterior Avenue",
      "That sounds normal",
    ]
  ) {
    const incidental = applyVolunteeredVoiceFacts(
      structuredClone(firm),
      utterance,
    );
    assertEquals(incidental.quoteStatus, "firm", utterance);
    assertEquals(
      incidental.fields.windowCleaningSides,
      "outside_only",
      utterance,
    );
    assertEquals(incidental.fields.condition, undefined, utterance);
    assertEquals(
      incidental.fields.lastQuoteResult?.estimatedTotal,
      200.26,
      utterance,
    );
  }
});

Deno.test("phase4 volunteered discount codes normalize without promotion conversion", () => {
  assertEquals(normalizeVolunteeredDiscountCode("My coupon code is save10"), "SAVE10");
  assertEquals(normalizeVolunteeredDiscountCode("discount code blue50"), "BLUE50");
  assertEquals(normalizeVolunteeredDiscountCode("I saw your $99 window special"), null);
  assertEquals(normalizeVolunteeredDiscountCode("I do not have a coupon"), null);
});

Deno.test("phase4 malformed discount cue is detected for one clarification", () => {
  assertEquals(hasVolunteeredDiscountCodeCue("my coupon code is ??"), true);
  assertEquals(hasVolunteeredDiscountCodeCue("outside window cleaning"), false);
});


Deno.test("phase4 malformed discount separators cue clarification without normalization", () => {
  for (const utterance of [
    "coupon code is SAVE-10",
    "coupon code is SAVE_10",
    "coupon code is SAVE 10",
    "coupon code is SAVE.10",
  ]) {
    assertEquals(normalizeVolunteeredDiscountCode(utterance), null, utterance);
    assertEquals(hasVolunteeredDiscountCodeCue(utterance), true, utterance);
  }
  assertEquals(normalizeVolunteeredDiscountCode("coupon code is save10"), "SAVE10");
  assertEquals(hasVolunteeredDiscountCodeCue("I saw your $99 window special"), false);
});
