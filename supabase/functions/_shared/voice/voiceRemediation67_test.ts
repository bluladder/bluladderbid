// ============================================================================
// Regression suite for the 019fb51e voice remediation (build 6.7):
// spoken-address normalization, the deterministic address confirmation gate,
// spoken-reply safety and exit/human-request handling.
// ============================================================================
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeSpokenAddress } from "./spokenAddress.ts";
import { normalizeVoiceInput } from "./voiceInputNormalizer.ts";
import {
  buildAddressReadback,
  classifyAddressConfirmation,
  planVoiceAddressGate,
} from "./voiceAddressGate.ts";
import {
  containsInternalReasoning,
  enforceSingleQuestion,
  nextPropertyQuestion,
  sanitizeVoiceReply,
} from "./voiceReplySafety.ts";
import {
  classifyVoiceExitIntent,
  planVoiceExitIntent,
  suppressAcknowledgement,
} from "./voiceExitIntents.ts";

Deno.test("exact Binbranch transcript normalizes to the spelled street", () => {
  const out = normalizeSpokenAddress(
    "Five six one two Branch Lane. B I N B R A N C H, McKinney, Texas 75071",
  );
  assertEquals(out.text, "5612 Binbranch Lane, McKinney, Texas 75071");
  assert(!/branch lane/i.test(out.text.replace(/binbranch/i, "")));
});

Deno.test("standalone spelling after a spelling prompt rebuilds the address", () => {
  const out = normalizeSpokenAddress(
    "B I N B R A N C H",
    "I have 5612 Branch Lane, McKinney, Texas 75071. Is that address right?",
  );
  assertEquals(out.text, "5612 Binbranch Lane, McKinney, Texas 75071");
});

Deno.test("spoken five six one two becomes 5612, not square footage", () => {
  const result = normalizeVoiceInput("five six one two", [
    { role: "assistant", content: "What is the house number on your address?" },
    { role: "user", content: "hi" },
  ]);
  assertEquals(result.text, "5612");
  assert(!result.applied.includes("square_footage"));
});

Deno.test("square footage normalization still works", () => {
  const result = normalizeVoiceInput("two thousand five hundred", [
    { role: "assistant", content: "About how many square feet is your home?" },
  ]);
  assertStringIncludes(result.text, "square feet");
});

Deno.test("geocoded candidate is never eligible before confirmation", () => {
  const gate = planVoiceAddressGate({
    formattedAddress: "5612 Binbranch Ln, McKinney, TX 75071",
    spokenAddress: "5612 Binbranch Lane, McKinney, Texas 75071",
  });
  assertEquals(gate.kind, "ask_confirmation");
  assertEquals(gate.serviceAreaStatus, "pending_confirmation");
  assertStringIncludes(gate.reply, "Is that complete address exactly right?");
});

Deno.test("readback preserves the canonical street and reads digits", () => {
  const readback = buildAddressReadback(
    "5612 Binbranch Ln, McKinney, TX 75071",
  );
  assertStringIncludes(readback, "five, six, one, two");
  assertStringIncludes(readback, "Binbranch Lane");
  assertStringIncludes(readback, "The city is McKinney.");
  assertStringIncludes(readback, "The state is Texas.");
  assertStringIncludes(readback, "seven, five, zero, seven, one");
});

Deno.test("explicit yes confirms; no/correction rejects", () => {
  assertEquals(classifyAddressConfirmation("Yes, that's right"), "yes");
  assertEquals(classifyAddressConfirmation("No, it's 5612"), "no");
  assertEquals(classifyAddressConfirmation("uh"), "unclear");
});

Deno.test("caller/geocoder house-number mismatch blocks (5610 regression)", () => {
  const gate = planVoiceAddressGate({
    formattedAddress: "5610 Binbranch Ln, McKinney, TX 75071",
    spokenAddress: "5612 Binbranch Lane, McKinney, Texas 75071",
  });
  assertEquals(gate.kind, "ask_house_number");
  assertEquals(gate.serviceAreaStatus, "pending_confirmation");
  assertStringIncludes(gate.reply, "one digit at a time");
});

Deno.test("an already confirmed address stays eligible", () => {
  const gate = planVoiceAddressGate({
    formattedAddress: "5612 Binbranch Ln, McKinney, TX 75071",
    spokenAddress: "5612 Binbranch Lane",
    alreadyConfirmedAddress: "5612 Binbranch Ln, McKinney, TX 75071",
  });
  assertEquals(gate.kind, "confirmed");
  assertEquals(gate.serviceAreaStatus, "eligible");
});

Deno.test("leaked internal reasoning is never spoken", () => {
  const leak =
    "thought Okay, I need `squareFootage` and `stories` for the window cleaning quote. Let me ask the user for these details.";
  assert(containsInternalReasoning(leak));
  const out = sanitizeVoiceReply(leak, nextPropertyQuestion({}));
  assertEquals(out.text, "About how many square feet is your home?");
  assert(out.applied.includes("internal_reasoning_suppressed"));
  assert(!out.text.toLowerCase().includes("thought"));
});

Deno.test("only one property question per spoken turn", () => {
  const two = "How many square feet is your home? And how many stories is it?";
  assertEquals(
    enforceSingleQuestion(two),
    "How many square feet is your home?",
  );
  const out = sanitizeVoiceReply(
    two,
    "About how many square feet is your home?",
  );
  assert(out.applied.includes("single_question"));
  assertEquals((out.text.match(/\?/g) ?? []).length, 1);
});

Deno.test("intake order asks square footage before stories", () => {
  assertStringIncludes(nextPropertyQuestion({}), "square feet");
  assertStringIncludes(
    nextPropertyQuestion({ property: { squareFootage: 2500 } }),
    "stories",
  );
});

Deno.test("hangup intent stops intake, hurry does not loop on filler", () => {
  assertEquals(classifyVoiceExitIntent("I'm about to hang up"), "leaving");
  assertEquals(classifyVoiceExitIntent("Please hurry"), "hurry");
  const leaving = planVoiceExitIntent("leaving");
  assert(leaving.stopsIntake);
  assertStringIncludes(leaving.reply, "online quote link");
  const hurry = planVoiceExitIntent("hurry", {
    nextQuestion: "How many stories is your home?",
  });
  assertEquals(hurry.reply, "How many stories is your home?");
});

Deno.test("Can I talk to Ben? produces one escalation and no quote question", () => {
  assertEquals(classifyVoiceExitIntent("Can I talk to Ben?"), "human_request");
  // 6.8: the reply is truthful about the actual escalation tool result.
  const first = planVoiceExitIntent("human_request", {
    escalationAlreadyRecorded: false,
    escalationSucceeded: true,
  });
  assertEquals(first.event, "voice_human_request_escalated");
  assert(first.stopsIntake);
  assert(!first.reply.includes("?"));
  const second = planVoiceExitIntent("human_request", {
    escalationAlreadyRecorded: true,
  });
  assertEquals(second.event, "voice_human_request_reused");
  assert(!second.reply.includes("?"));
});

Deno.test("no acknowledgement in front of deterministic replies", () => {
  assert(suppressAcknowledgement("Can I talk to Ben?"));
  assert(suppressAcknowledgement("I'm about to hang up"));
  assert(suppressAcknowledgement("No, that's wrong"));
  assert(suppressAcknowledgement("B I N B R A N C H"));
  assert(
    !suppressAcknowledgement(
      "How much for window cleaning on a two story home?",
    ),
  );
});
