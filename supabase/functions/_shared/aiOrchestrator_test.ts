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
} from "./aiOrchestrator.ts";

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