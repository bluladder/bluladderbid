import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeQuestion } from "./knowledgeGaps.ts";

Deno.test("rephrasings normalize to the same key", () => {
  const a = normalizeQuestion("Do you clean solar panels?");
  const b = normalizeQuestion("Can you clean my solar panels please?");
  assertEquals(a, b);
});

Deno.test("empty/stopword-only questions produce no key", () => {
  assertEquals(normalizeQuestion("do you?"), "");
});
