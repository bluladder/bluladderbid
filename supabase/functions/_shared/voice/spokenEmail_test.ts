import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSpokenEmailReadback, parseSpokenEmail } from "./spokenEmail.ts";

Deno.test("spoken email: written address passes through", () => {
  assertEquals(parseSpokenEmail("ben@bluladder.com"), "ben@bluladder.com");
});

Deno.test("spoken email: ASR 'at ... dot com' form", () => {
  assertEquals(
    parseSpokenEmail("my email is ben at bluladder dot com"),
    "ben@bluladder.com",
  );
});

Deno.test("spoken email: spelled local part and dotted local part", () => {
  assertEquals(
    parseSpokenEmail("it's b l m i l l e n at gmail dot com"),
    "blmillen@gmail.com",
  );
  assertEquals(
    parseSpokenEmail(
      "sure, my e-mail address is ben dot millen at bluladder dot com",
    ),
    "ben.millen@bluladder.com",
  );
});

Deno.test("spoken email: nothing usable returns null (re-ask, never guess)", () => {
  assertEquals(parseSpokenEmail("just the phone please"), null);
  assertEquals(parseSpokenEmail(""), null);
  assertEquals(parseSpokenEmail("no thanks"), null);
});

Deno.test("spoken email: two candidates are ambiguous", () => {
  assertEquals(
    parseSpokenEmail("use ben at gmail dot com or sara at gmail dot com"),
    null,
  );
  assertEquals(parseSpokenEmail("ben@a.com and sara@b.com"), null);
});

Deno.test("spoken email: readback spells identity with deliberate punctuation", () => {
  assertEquals(
    buildSpokenEmailReadback("ben.millen+2@bluladder.com"),
    "I heard the email as: B, E, N. Dot. M, I, L, L, E, N. Plus. two. At. B, L, U, L, A, D, D, E, R. Dot. C, O, M. Is that exactly right?",
  );
});
