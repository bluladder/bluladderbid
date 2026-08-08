import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  confirmationPrompt,
  interpretConfirmation,
  last4,
  normalizeSpokenPhone,
} from "./callerIdConfirmation.ts";

Deno.test("confirmation prompt uses last-4 only and never speaks the full number", () => {
  const prompt = confirmationPrompt("+14697472877");
  assertEquals(prompt.includes("2877"), true);
  assertEquals(prompt.includes("469747"), false);
  assertEquals(prompt.includes("+1"), false);
  assertEquals(last4("+14697472877"), "2877");
});

Deno.test("interpretConfirmation: yes/no/unclear", () => {
  assertEquals(interpretConfirmation("yes that's right"), "confirmed");
  assertEquals(interpretConfirmation("yep"), "confirmed");
  assertEquals(interpretConfirmation("no use a different one"), "declined");
  assertEquals(interpretConfirmation("call me at 469 555 1212"), "declined");
  assertEquals(interpretConfirmation("hmm"), "unclear");
  assertEquals(interpretConfirmation(""), "unclear");
});

Deno.test("normalizeSpokenPhone accepts 10-digit and returns E.164", () => {
  assertEquals(normalizeSpokenPhone("469 555 1212"), "+14695551212");
  assertEquals(normalizeSpokenPhone("1 469 555 1212"), "+14695551212");
  assertEquals(
    normalizeSpokenPhone(
      "four six nine seven four seven two eight seven seven",
    ),
    "+14697472877",
  );
  assertEquals(
    normalizeSpokenPhone("four six nine, 747, two eight seven seven"),
    "+14697472877",
  );
  assertEquals(
    normalizeSpokenPhone(
      "one four six nine seven four seven two eight seven seven",
    ),
    "+14697472877",
  );
  assertEquals(
    normalizeSpokenPhone("use the one ending in two eight seven seven"),
    null,
  );
  assertEquals(
    normalizeSpokenPhone("call me at four to nine for service"),
    null,
  );
  assertEquals(normalizeSpokenPhone("hello"), null);
});
