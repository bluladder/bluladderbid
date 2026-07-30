import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeVoiceAdapterRequest,
  normalizeVoiceUserTurn,
  parseSpokenSquareFootage,
  parseSpokenStories,
} from "./voiceInputNormalizer.ts";

Deno.test("call regression: bare one answers the story question", () => {
  assertEquals(
    normalizeVoiceUserTurn("one", "Is it a one-story or two-story home?"),
    "1 story",
  );
  assertEquals(
    normalizeVoiceUserTurn("1", "How many stories is the home?"),
    "1 story",
  );
  assertEquals(parseSpokenStories("single story"), 1);
});

Deno.test("call regression: digit-by-digit square footage becomes 2500", () => {
  assertEquals(parseSpokenSquareFootage("two five zero zero"), 2500);
  assertEquals(parseSpokenSquareFootage("twenty five hundred"), 2500);
  assertEquals(parseSpokenSquareFootage("two thousand five hundred"), 2500);
  assertEquals(
    normalizeVoiceUserTurn("two five zero zero", "About how large is the home in square feet?"),
    "2500 square feet",
  );
});

Deno.test("address street numbers are never inferred as square footage", () => {
  assertEquals(
    normalizeVoiceUserTurn("5612 Binbranch Lane", "What is the full service address?"),
    "5612 Binbranch Lane",
  );
  assertEquals(
    normalizeVoiceUserTurn("5612", "What is the street number?"),
    "5612",
  );
});

Deno.test("window side shorthand is normalized only in side-selection context", () => {
  assertEquals(
    normalizeVoiceUserTurn("outside", "Is that exterior only, or inside and outside?"),
    "exterior only",
  );
  assertEquals(
    normalizeVoiceUserTurn("both", "Would you like exterior only or full service window cleaning?"),
    "inside and outside",
  );
});

Deno.test("adapter request normalizes only the final user turn", () => {
  const request = normalizeVoiceAdapterRequest({
    model: "test",
    stream: true,
    sessionId: "vapi_call:test",
    sessionIdIsSynthetic: false,
    callerIdE164: "+14692150144",
    rawBody: {},
    messages: [
      { role: "user", content: "window cleaning" },
      { role: "assistant", content: "Is it a one-story or two-story home?" },
      { role: "user", content: "one" },
    ],
  });

  assertEquals(request.messages[0].content, "window cleaning");
  assertEquals(request.messages[2].content, "1 story");
});
