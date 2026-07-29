import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isResumedQuoteBookable,
  parseResumedQuoteBooking,
} from "./resumedQuoteBooking.ts";

const QUOTE_ID = "123e4567-e89b-42d3-a456-426614174000";
const TOKEN = ["quote", "booking", "capability", "fixture"].join("-");

Deno.test("ordinary bookings do not require quote authorization", () => {
  assertEquals(parseResumedQuoteBooking({}), { kind: "none" });
});

Deno.test("partial resumed-quote claims fail closed", () => {
  assertEquals(
    parseResumedQuoteBooking({ resumedQuoteId: QUOTE_ID }),
    { kind: "invalid" },
  );
  assertEquals(
    parseResumedQuoteBooking({
      resumedQuoteId: QUOTE_ID,
      resumedQuoteToken: TOKEN,
    }),
    { kind: "invalid" },
  );
});

Deno.test("complete resumed-quote claims preserve the confirmed total", () => {
  assertEquals(
    parseResumedQuoteBooking({
      resumedQuoteId: QUOTE_ID,
      resumedQuoteToken: TOKEN,
      confirmedTotal: 249,
    }),
    {
      kind: "valid",
      quoteId: QUOTE_ID,
      resumeToken: TOKEN,
      confirmedTotal: 249,
    },
  );
});

Deno.test("malformed identifiers, capabilities, and totals are rejected", () => {
  assertEquals(
    parseResumedQuoteBooking({
      resumedQuoteId: "quote-1",
      resumedQuoteToken: TOKEN,
      confirmedTotal: 249,
    }).kind,
    "invalid",
  );
  assertEquals(
    parseResumedQuoteBooking({
      resumedQuoteId: QUOTE_ID,
      resumedQuoteToken: "short",
      confirmedTotal: 249,
    }).kind,
    "invalid",
  );
  assertEquals(
    parseResumedQuoteBooking({
      resumedQuoteId: QUOTE_ID,
      resumedQuoteToken: TOKEN,
      confirmedTotal: -1,
    }).kind,
    "invalid",
  );
});

Deno.test("only active quote lifecycle states are bookable", () => {
  const future = "2030-01-01T00:00:00.000Z";
  const now = new Date("2029-01-01T00:00:00.000Z").getTime();
  assertEquals(isResumedQuoteBookable("pending", future, now), true);
  assertEquals(isResumedQuoteBookable("viewed", future, now), true);
  assertFalse(isResumedQuoteBookable("converted", future, now));
  assertFalse(isResumedQuoteBookable("declined", future, now));
  assertFalse(isResumedQuoteBookable("unknown", future, now));
  assertFalse(
    isResumedQuoteBookable(
      "pending",
      "2028-01-01T00:00:00.000Z",
      now,
    ),
  );
});
