// Focused unit tests for the deterministic post-yes booking rail helpers in
// aiOrchestrator. These prove the anti-hallucination guarantees without any
// live model or Jobber calls: (1) confirmed-language detection, (2) the
// post-hoc reply guard that refuses to assert "confirmed" unless the booking
// tool actually returned status:"confirmed", (3) slot disambiguation that
// only fires the rail when a single specific offered slot can be pinned.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  guardConfirmedLanguage,
  resolveUnambiguousOfferedSlot,
  textAssertsConfirmed,
  shouldSkipRoughQuoteReplay,
} from "./aiOrchestrator.ts";
import { quoteInputsKey } from "./conversationState.ts";

Deno.test("textAssertsConfirmed matches common confirmation phrasings", () => {
  assert(textAssertsConfirmed("You're all booked for Tuesday at 9am."));
  assert(textAssertsConfirmed("Your appointment is confirmed."));
  assert(textAssertsConfirmed("We've booked you in."));
  assert(textAssertsConfirmed("All set for Tuesday!"));
  assert(!textAssertsConfirmed("Would you like me to book this appointment?"));
  assert(!textAssertsConfirmed("I can offer Tue 9am or Wed 1pm."));
  assert(!textAssertsConfirmed(""));
});

Deno.test("guardConfirmedLanguage rewrites hallucinated confirmations", () => {
  const facts = { bookingStatus: "none" } as any;
  const out = guardConfirmedLanguage("You're all booked!", facts, false);
  assert(!/booked/i.test(out) || /finalizing/i.test(out));
  assert(/finalizing/i.test(out));
});

Deno.test("guardConfirmedLanguage passes through when tool actually confirmed", () => {
  const facts = { bookingStatus: "confirmed" } as any;
  const reply = "You're all booked for Tuesday at 9am.";
  assertEquals(guardConfirmedLanguage(reply, facts, true), reply);
});

Deno.test("guardConfirmedLanguage passes through non-confirmation replies", () => {
  const facts = { bookingStatus: "none" } as any;
  const reply = "Would you like me to book Tuesday at 9am?";
  assertEquals(guardConfirmedLanguage(reply, facts, false), reply);
});

// -----------------------------------------------------------------------
// Regression: voice rough-quote rail must not re-speak the estimate on
// scheduling intents. Reproduces call 019f8b20-2417-7ffe-a4cf-ea1245f821a6.
// -----------------------------------------------------------------------
function factsWithCurrentQuote(): any {
  const f: any = {
    services: ["window_cleaning"],
    property: { squareFootage: 2200, stories: 2, windowCleaningType: "exterior" },
    roughQuote: { intent: true, city: "Frisco", cityStatus: "normal_service_city" },
  };
  f.quote = {
    status: "estimated",
    firm: false,
    total: 185,
    inputsKey: quoteInputsKey(f),
  };
  return f;
}

Deno.test("rough-quote replay guard: skips on scheduling intent after quote", () => {
  const f = factsWithCurrentQuote();
  for (const msg of [
    "when are you available?",
    "Can I get on the schedule?",
    "what do you have this week",
    "book me for Tuesday",
    "yes",
  ]) {
    assert(shouldSkipRoughQuoteReplay(f, msg), `expected skip for: ${msg}`);
  }
});

Deno.test("rough-quote replay guard: re-runs when customer explicitly asks for the price again", () => {
  const f = factsWithCurrentQuote();
  for (const msg of [
    "what was the price again?",
    "can you remind me of the quote?",
    "how much did you say?",
    "what's the estimate?",
  ]) {
    assert(!shouldSkipRoughQuoteReplay(f, msg), `expected re-run for: ${msg}`);
  }
});

Deno.test("rough-quote replay guard: no current quote → do not skip (rail may quote for the first time)", () => {
  const f: any = { services: ["window_cleaning"], roughQuote: { intent: true } };
  assert(!shouldSkipRoughQuoteReplay(f, "when are you available?"));
});

// Minimal supabase stub — only the shape resolveUnambiguousOfferedSlot uses.
function makeSupabaseWithOffered(offered: any[]) {
  return {
    from(_t: string) {
      return {
        select(_c: string) {
          return {
            eq(_k: string, _v: unknown) {
              return {
                eq(_k2: string, _v2: unknown) {
                  return {
                    order(_col: string, _opts: unknown) {
                      return {
                        limit(_n: number) {
                          return Promise.resolve({
                            data: [{ tool_result: { offered } }],
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as any;
}

Deno.test("resolveUnambiguousOfferedSlot returns the sole offered slot", async () => {
  const supa = makeSupabaseWithOffered([{ slotId: "slot_A", displayTime: "Tue 9am" }]);
  const got = await resolveUnambiguousOfferedSlot(supa, "c1", {} as any, []);
  assertEquals(got, "slot_A");
});

Deno.test("resolveUnambiguousOfferedSlot picks a slot uniquely mentioned in last assistant turn", async () => {
  const supa = makeSupabaseWithOffered([
    { slotId: "slot_A", displayTime: "Tue 9am" },
    { slotId: "slot_B", displayTime: "Wed 1pm" },
  ]);
  const got = await resolveUnambiguousOfferedSlot(
    supa,
    "c1",
    {} as any,
    [
      { role: "user", content: "any options this week?" },
      { role: "assistant", content: "How about Wed 1pm — does that work?" },
    ],
  );
  assertEquals(got, "slot_B");
});

Deno.test("resolveUnambiguousOfferedSlot returns null when ambiguous", async () => {
  const supa = makeSupabaseWithOffered([
    { slotId: "slot_A", displayTime: "Tue 9am" },
    { slotId: "slot_B", displayTime: "Wed 1pm" },
  ]);
  const got = await resolveUnambiguousOfferedSlot(
    supa,
    "c1",
    {} as any,
    [{ role: "assistant", content: "I have Tue 9am or Wed 1pm — which works?" }],
  );
  assertEquals(got, null);
});

Deno.test("resolveUnambiguousOfferedSlot honors an already-selected valid slot", async () => {
  const supa = makeSupabaseWithOffered([
    { slotId: "slot_A", displayTime: "Tue 9am" },
    { slotId: "slot_B", displayTime: "Wed 1pm" },
  ]);
  const facts = {
    selectedSlotId: "slot_B",
    availability: { offeredSlotIds: ["slot_A", "slot_B"] },
  } as any;
  const got = await resolveUnambiguousOfferedSlot(supa, "c1", facts, []);
  assertEquals(got, "slot_B");
});