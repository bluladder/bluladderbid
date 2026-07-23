import { assertEquals } from "https://deno.land/std@0.224.0/testing/asserts.ts";
import { parseConfirmationReply, CLARIFICATION_ASK } from "./confirmationParser.ts";

function expectStatus(input: string, s: "confirmed" | "declined" | "unclear") {
  const r = parseConfirmationReply(input);
  assertEquals(r.status, s, `for input ${JSON.stringify(input)}`);
  if (s === "unclear") assertEquals(r.clarification_message, CLARIFICATION_ASK);
  else assertEquals(r.clarification_message, null);
}

Deno.test("parseConfirmationReply — accepts the canonical confirm phrases", () => {
  const yes = [
    "YES", "Yes", "yes", "Y", "y", "yep", "Yeah",
    "Correct", "Confirm", "confirmed", "book it", "Book it",
    "Let's do it", "lets do it", "sounds good", "looks good",
    "that's fine", "that's perfect", "ok", "okay", "perfect", "great",
    "yes.", "yes!", "yes ", " Yes ",
  ];
  for (const t of yes) expectStatus(t, "confirmed");
});

Deno.test("parseConfirmationReply — rejects declines", () => {
  for (const t of ["no", "No", "N", "nope", "cancel", "not now", "nevermind", "never mind", "wait"]) {
    expectStatus(t, "declined");
  }
});

Deno.test("parseConfirmationReply — unclear replies request YES/NO clarification", () => {
  for (const t of [
    "", "   ", "how much is that", "actually 3pm", "yes but move to friday",
    "what services are included", "call me first",
  ]) expectStatus(t, "unclear");
});

Deno.test("parseConfirmationReply — never treats a decline as a confirmation", () => {
  // Regression guard: 'no' is short and could accidentally match a broad
  // yes pattern if patterns were loosened later.
  assertEquals(parseConfirmationReply("no").status, "declined");
  assertEquals(parseConfirmationReply("NO").status, "declined");
});