import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeVoiceInput,
  normalizeVoiceMessages,
} from "./voiceInputNormalizer.ts";

const storiesQ = [{
  role: "assistant" as const,
  content: "Is it a one-story or two-story home?",
}];
const sqftQ = [{
  role: "assistant" as const,
  content: "About how large is the home in square feet?",
}];

Deno.test("bare story answers are normalized before routing", () => {
  for (
    const [utterance, expected] of [
      ["one", 1],
      ["1", 1],
      ["single", 1],
      ["ranch", 1],
      ["two", 2],
      ["2", 2],
    ] as const
  ) {
    const r = normalizeVoiceInput(utterance, storiesQ);
    assert(
      r.applied.includes("stories"),
      `expected stories for "${utterance}"`,
    );
    assert(r.text.includes(`(${expected} story)`), r.text);
  }
});

Deno.test("spoken square footage is normalized to an explicit unit phrase", () => {
  for (
    const [utterance, expected] of [
      ["two thousand five hundred", 2500],
      ["two five zero zero", 2500],
      ["twenty five hundred", 2500],
      ["2500", 2500],
    ] as const
  ) {
    const r = normalizeVoiceInput(utterance, sqftQ);
    assert(r.applied.includes("square_footage"), utterance);
    assert(r.text.includes(`(${expected} square feet)`), r.text);
  }
});

Deno.test("address-shaped replies are never rewritten as sqft or stories", () => {
  const r = normalizeVoiceInput("5610 Wood Bridge Lane, Allen TX 75002", sqftQ);
  assertEquals(r.applied, []);
  assertEquals(r.text, "5610 Wood Bridge Lane, Allen TX 75002");
});

Deno.test("window-side shorthand is canonicalized", () => {
  assertEquals(normalizeVoiceInput("just the outside").text, "exterior only");
  assertEquals(normalizeVoiceInput("outside only").text, "exterior only");
  assertEquals(normalizeVoiceInput("in and out").text, "inside and outside");
});

Deno.test("bare window-side answers require explicit side-selection context", () => {
  const sidesQ = [{
    role: "assistant" as const,
    content:
      "Would you like all the windows cleaned both inside and outside, or outside only?",
  }];
  assertEquals(normalizeVoiceInput("outside", sidesQ).text, "exterior only");
  assertEquals(normalizeVoiceInput("both", sidesQ).text, "inside and outside");
  assertEquals(normalizeVoiceInput("outside", []).text, "outside");
  assertEquals(normalizeVoiceInput("both", []).text, "both");
});

Deno.test("no-context utterances pass through untouched", () => {
  const r = normalizeVoiceInput("one", []);
  assertEquals(r.applied, []);
  assertEquals(r.text, "one");
});

Deno.test("normalizeVoiceMessages rewrites only the last user message", () => {
  const { messages, applied } = normalizeVoiceMessages([
    { role: "system", content: "sys" },
    { role: "user", content: "windows please" },
    { role: "assistant", content: "Is it a one-story or two-story home?" },
    { role: "user", content: "one" },
  ]);
  assertEquals(applied, ["stories"]);
  assertEquals(messages[1].content, "windows please");
  assert(messages[3].content.includes("(1 story)"));
});
