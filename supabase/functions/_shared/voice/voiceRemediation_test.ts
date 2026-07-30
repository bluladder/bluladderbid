// Regression tests for Vapi call 019fb423-7a5b-7990-98fe-6e7db8062f50.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isFullE164, normalizeUsCaE164, resolvePhone } from "../contactIntegrity.ts";
import { hasContact, mergeFacts, type ConversationFacts } from "../conversationState.ts";
import { computeRequired, mergeFields, normalizePhone, type QuoteSession } from "../quoteSession.ts";
import {
  askedSquareFootageQuestion,
  askedStoriesQuestion,
  isRepeatPriceRequest,
  parseSquareFootage,
  parseStories,
  parseWindowType,
  shouldSkipRoughQuoteReplay,
  spokenToNumber,
} from "../aiOrchestrator.ts";
import { classifyQuoteByTextRequest, guardDeliveryClaims, planQuoteByTextResponse } from "./quoteByText.ts";
import { buildTurnRows, sanitizeTurnContent } from "./turnJournal.ts";
import { deSpacedStreetCandidates } from "../profile/normalizeAddress.ts";

// ---------------------------------------------------------------------------
// P0 — contact integrity
// ---------------------------------------------------------------------------
Deno.test("normalizeUsCaE164 rejects short values and never fabricates +0144", () => {
  assertEquals(normalizeUsCaE164("0144"), null);
  assertEquals(normalizeUsCaE164("144"), null);
  assertEquals(normalizeUsCaE164(""), null);
  assertEquals(normalizeUsCaE164("469-215-0144"), "+14692150144");
  assertEquals(normalizeUsCaE164("14692150144"), "+14692150144");
  assertEquals(normalizeUsCaE164("+1 (469) 215-0144"), "+14692150144");
  assertEquals(normalizePhone("0144"), null);
  assert(isFullE164("+14692150144"));
  assert(!isFullE164("+0144"));
});

Deno.test("confirmed E.164 survives a later '0144' extraction (facts)", () => {
  let facts: ConversationFacts = {};
  facts = mergeFacts(facts, { contact: { phone: "+14692150144", phoneConfirmed: true } });
  // Legacy extraction pulls the last four digits out of the assistant prompt.
  facts = mergeFacts(facts, { contact: { phone: "0144" } });
  assertEquals(facts.contact?.phone, "+14692150144");
  assertEquals(facts.contact?.phoneConfirmed, true);
});

Deno.test("confirmed E.164 survives a later '0144' extraction (quote session)", () => {
  const base: QuoteSession = {
    id: "s1", channel: "voice", conversationIds: [], fields: {}, fieldStatus: {},
    requiredRemaining: [], quoteStatus: "none", bookingReady: false,
  };
  let s = mergeFields(base, { phone: "+14692150144" }, { markVerified: ["phone"] });
  assertEquals(s.fields.phone, "+14692150144");
  s = mergeFields(s, { phone: "0144" });
  assertEquals(s.fields.phone, "+14692150144");
  // Even without verified status, an explicit caller-ID confirmation protects it.
  let s2 = mergeFields(base, { phone: "+14692150144", callerIdConfirmationStatus: "contact_confirmed" });
  s2 = mergeFields(s2, { phone: "0144" });
  assertEquals(s2.fields.phone, "+14692150144");
});

Deno.test("resolvePhone discards invalid candidates but accepts real corrections", () => {
  assertEquals(resolvePhone({ existing: "+14692150144", existingConfirmed: true, candidate: "0144" }), "+14692150144");
  assertEquals(
    resolvePhone({ existing: "+14692150144", existingConfirmed: false, candidate: "214-555-1212" }),
    "+12145551212",
  );
  assertEquals(
    resolvePhone({ existing: "+14692150144", existingConfirmed: true, candidate: "214-555-1212", candidateConfirmed: true }),
    "+12145551212",
  );
});

// ---------------------------------------------------------------------------
// P0 — truthful quote-by-text
// ---------------------------------------------------------------------------
Deno.test("quote-by-text intent recognition", () => {
  assert(classifyQuoteByTextRequest("can you text me the quote"));
  assert(classifyQuoteByTextRequest("Text me that price please"));
  assert(!classifyQuoteByTextRequest("what is the price"));
});

Deno.test("quote-by-text never claims a send when delivery is unavailable", async () => {
  const plan = await planQuoteByTextResponse({
    quoteIsFirm: true, total: 200, name: "Ben", phone: "+14692150144", phoneIsFullE164: true, deliver: null,
  });
  assertEquals(plan.sent, false);
  assertEquals(plan.outcome, "not_sent_delivery_unavailable");
  assert(/no text has been sent/i.test(plan.reply));
});

Deno.test("quote-by-text asks for the full number instead of promising", async () => {
  const plan = await planQuoteByTextResponse({
    quoteIsFirm: true, total: 200, name: "Ben", phone: "0144", phoneIsFullE164: false, deliver: null,
  });
  assertEquals(plan.missingField, "phone");
  assert(/haven't sent that text yet/i.test(plan.reply));
});

Deno.test("quote-by-text confirms only after a successful send", async () => {
  const ok = await planQuoteByTextResponse({
    quoteIsFirm: true, total: 200, name: "Ben", phone: "+14692150144", phoneIsFullE164: true,
    deliver: () => Promise.resolve({ ok: true }),
  });
  assertEquals(ok.sent, true);
  const failed = await planQuoteByTextResponse({
    quoteIsFirm: true, total: 200, name: "Ben", phone: "+14692150144", phoneIsFullE164: true,
    deliver: () => Promise.resolve({ ok: false }),
  });
  assertEquals(failed.sent, false);
  assert(/didn'?t go through/i.test(failed.reply));
});

Deno.test("guardDeliveryClaims strips false send claims", () => {
  const claim = "I've texted the quote to you.";
  assert(!/texted/i.test(guardDeliveryClaims(claim, false)));
  assertEquals(guardDeliveryClaims(claim, true), claim);
  assertEquals(guardDeliveryClaims("Your price is about $200.", false), "Your price is about $200.");
});

// ---------------------------------------------------------------------------
// P1 — parsers
// ---------------------------------------------------------------------------
Deno.test("stories: bare 'one' works when the assistant just asked", () => {
  const asked = askedStoriesQuestion("Is it a one-story or two-story home?");
  assert(asked);
  assertEquals(parseStories("one", { askedStories: asked }), 1);
  assertEquals(parseStories("1", { askedStories: asked }), 1);
  assertEquals(parseStories("single", { askedStories: asked }), 1);
  assertEquals(parseStories("single story", { askedStories: asked }), 1);
  assertEquals(parseStories("one level", { askedStories: asked }), 1);
  assertEquals(parseStories("ranch", { askedStories: asked }), 1);
  assertEquals(parseStories("two", { askedStories: asked }), 2);
  assertEquals(parseStories("2", { askedStories: asked }), 2);
});

Deno.test("stories: '1 story' works without context, bare numbers do not", () => {
  assertEquals(parseStories("1 story"), 1);
  assertEquals(parseStories("two stories"), 2);
  assertEquals(parseStories("one"), undefined);
  assertEquals(parseStories("my address is 2 Oak Street, Allen TX 75002", { askedStories: true }), undefined);
});

Deno.test("square footage: bare 4-digit street numbers are never consumed", () => {
  // The reported failure: street number 5610 became square footage.
  assertEquals(parseSquareFootage("5610 Wood Bridge Lane"), undefined);
  assertEquals(parseSquareFootage("5610 Wood Bridge Lane, Allen TX 75002", { askedSquareFootage: true }), undefined);
  assertEquals(parseSquareFootage("it's 2500"), undefined);
});

Deno.test("square footage: unitless and spoken answers work in question context", () => {
  const asked = askedSquareFootageQuestion("Sure. About how large is the home in square feet?");
  assert(asked);
  assertEquals(parseSquareFootage("2500", { askedSquareFootage: asked }), 2500);
  assertEquals(parseSquareFootage("about 2,500", { askedSquareFootage: asked }), 2500);
  assertEquals(parseSquareFootage("two thousand five hundred", { askedSquareFootage: asked }), 2500);
  assertEquals(parseSquareFootage("two five zero zero", { askedSquareFootage: asked }), 2500);
  assertEquals(parseSquareFootage("2500 square feet"), 2500);
});

Deno.test("spokenToNumber handles grouped and digit-by-digit forms", () => {
  assertEquals(spokenToNumber("two thousand five hundred"), 2500);
  assertEquals(spokenToNumber("twenty five hundred"), 2500);
  assertEquals(spokenToNumber("two five zero zero"), 2500);
  assertEquals(spokenToNumber("hello there"), undefined);
});

Deno.test("window type is sticky and negation-aware", () => {
  assertEquals(parseWindowType("exterior only"), "exterior");
  // Reported drift: "not inside" upgraded exterior -> both.
  assertEquals(parseWindowType("not inside", "exterior"), "exterior");
  assertEquals(parseWindowType("I don't need interior", "exterior"), "exterior");
  assertEquals(parseWindowType("no, just the outside", "exterior"), "exterior");
  // A question that merely mentions full service must not change anything.
  assertEquals(parseWindowType("what does full service mean?", "exterior"), "exterior");
  assertEquals(parseWindowType("does that include the inside", "exterior"), "exterior");
  // Explicit affirmative upgrade is honored.
  assertEquals(parseWindowType("yes, inside and out please", "exterior"), "both");
  // No signal at all keeps the established value.
  assertEquals(parseWindowType("sounds good", "exterior"), "exterior");
  assertEquals(parseWindowType("sounds good", null), undefined);
});

// ---------------------------------------------------------------------------
// P1 — quote replay
// ---------------------------------------------------------------------------
function firmQuoteFacts(): ConversationFacts {
  const base: ConversationFacts = {
    services: ["window_cleaning"],
    property: { squareFootage: 2500, stories: 1, windowCleaningType: "exterior" },
  };
  // inputsKey must match quoteInputsKey(base) — build via mergeFacts round-trip.
  return base;
}

Deno.test("quote is not recalculated when pricing inputs are unchanged", async () => {
  const { quoteInputsKey } = await import("../conversationState.ts");
  const base = firmQuoteFacts();
  const key = quoteInputsKey(base);
  const facts: ConversationFacts = {
    ...base,
    quote: { status: "firm", firm: true, total: 200, inputsKey: key },
    roughQuote: { intent: true, spokenInputsKey: key, spokenTotal: 200 },
  };
  // Merely mentioning price/quote does not re-price.
  assertEquals(shouldSkipRoughQuoteReplay(facts, "ok, that quote works for me"), true);
  assertEquals(shouldSkipRoughQuoteReplay(facts, "when are you available?"), true);
  // Direct repeat requests fall through to the rail, which repeats the stored
  // total without invoking calculate-quote again.
  assertEquals(shouldSkipRoughQuoteReplay(facts, "can you say the price again"), false);
  assertEquals(shouldSkipRoughQuoteReplay(facts, "what's the price"), false);
  assert(isRepeatPriceRequest("what was that price again"));
  assert(isRepeatPriceRequest("how much did you say"));
  assert(!isRepeatPriceRequest("go ahead and book it"));
  // Changed inputs re-enable pricing.
  const changed: ConversationFacts = { ...facts, property: { ...facts.property, squareFootage: 3200 } };
  assertEquals(shouldSkipRoughQuoteReplay(changed, "anything else?"), false);
});

// ---------------------------------------------------------------------------
// P2 — flow completion
// ---------------------------------------------------------------------------
Deno.test("phone-confirmed caller counts as reachable for availability", () => {
  assertEquals(hasContact({ contact: { phone: "+14692150144" } }), false);
  assertEquals(hasContact({ contact: { phone: "+14692150144", phoneConfirmed: true } }), true);
  assertEquals(hasContact({ contact: { email: "a@b.com" } }), true);
  assertEquals(hasContact({ contact: { phone: "0144", phoneConfirmed: true } }), false);
});

Deno.test("whole-home priced session does not report partial-window fields as required", () => {
  assertEquals(
    computeRequired({
      services: ["windowCleaning"], windowCleaningScope: "partial",
      squareFootage: 2500, stories: 1, windowCleaningType: "exterior",
    }),
    [],
  );
  // A genuine partial request still requires per-window inputs.
  assertEquals(
    computeRequired({ services: ["windowCleaning"], windowCleaningScope: "partial" }),
    ["windowCount", "windowCleaningSides"],
  );
});

Deno.test("de-spaced street candidate preserves house number, city, state and ZIP", () => {
  assertEquals(
    deSpacedStreetCandidates("5610 Wood Bridge Lane, Allen, TX 75002"),
    ["5610 Woodbridge Lane, Allen, TX 75002"],
  );
  assertEquals(deSpacedStreetCandidates("5610 Woodbridge Lane, Allen, TX 75002"), []);
  assertEquals(deSpacedStreetCandidates(""), []);
});

// ---------------------------------------------------------------------------
// P2 — turn journal
// ---------------------------------------------------------------------------
Deno.test("turn journal links turns to the conversation and call, and redacts secrets", () => {
  const rows = buildTurnRows({
    conversationId: "conv-1",
    callId: "vapi_call:019fb423",
    state: "voice_rough_quote",
    turns: [
      { role: "user", content: "my api_key=sk_live_abcdef123456 is here" },
      { role: "assistant", content: "About $200." },
      { role: "user", content: "   " },
    ],
  });
  assertEquals(rows.length, 2);
  assertEquals(rows[0].conversation_id, "conv-1");
  assertEquals((rows[0].ai_metadata as any).provider_call_id, "vapi_call:019fb423");
  assertEquals((rows[0].ai_metadata as any).channel, "voice");
  assert(!/sk_live/.test(rows[0].content as string));
  assertEquals(sanitizeTurnContent("Bearer abcdef1234567890"), "[redacted]");
});
