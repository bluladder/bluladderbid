import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeEmailAddr } from "./emailSuppression.ts";

Deno.test("normalizeEmailAddr lowercases + trims", () => {
  assertEquals(normalizeEmailAddr("  User@Example.COM "), "user@example.com");
  assertEquals(normalizeEmailAddr(""), null);
  assertEquals(normalizeEmailAddr(null), null);
  assertEquals(normalizeEmailAddr(undefined), null);
});