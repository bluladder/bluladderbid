import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { QuoteSession } from "../quoteSession.ts";
import {
  applyApprovedWindowDefaults,
  applyVolunteeredVoiceFacts,
  isProviderRecordingNotice,
  nextExpressPrePriceField,
  normalizeVolunteeredDiscountCode,
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
    isProviderRecordingNotice("This call may be recorded for quality assurance"),
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
  assertEquals(next.fields.answerProvenance?.stories, "approved_business_default");
  assertEquals(next.fields.answerProvenance?.condition, "approved_business_default");
  assertEquals(next.fields.voiceJourney?.policyVersion, "voice-express-v1");
});

Deno.test("express path asks only true pricing gaps", () => {
  const initial = applyApprovedWindowDefaults(
    session({ services: ["window_cleaning"] }),
  );
  assertEquals(nextExpressPrePriceField(initial), "squareFootage");
  const withSqft = applyVolunteeredVoiceFacts(initial, "The home is 2,000 square feet.");
  assertEquals(nextExpressPrePriceField(withSqft), "windowCleaningSides");
  const complete = applyVolunteeredVoiceFacts(withSqft, "Outside only.");
  assertEquals(nextExpressPrePriceField(complete), null);
});

Deno.test("volunteered discount codes normalize without asking proactively", () => {
  assertEquals(normalizeVolunteeredDiscountCode("My coupon code is blue50"), "BLUE50");
  assertEquals(normalizeVolunteeredDiscountCode("I do not have a coupon"), null);
});
