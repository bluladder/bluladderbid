import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computePartialWindowPrice, PARTIAL_WINDOW_RULE_VERSION } from "./partialWindowPricing.ts";

Deno.test("1 window, outside only = $10", () => {
  assertEquals(computePartialWindowPrice({ windowCount: 1, sides: "outside_only" }).price, 10);
});
Deno.test("1 window, inside and outside = $20", () => {
  assertEquals(computePartialWindowPrice({ windowCount: 1, sides: "inside_and_outside" }).price, 20);
});
Deno.test("5 windows, outside only = $50", () => {
  assertEquals(computePartialWindowPrice({ windowCount: 5, sides: "outside_only" }).price, 50);
});
Deno.test("5 windows, inside and outside = $100", () => {
  assertEquals(computePartialWindowPrice({ windowCount: 5, sides: "inside_and_outside" }).price, 100);
});
Deno.test("carries canonical rule version", () => {
  assertEquals(
    computePartialWindowPrice({ windowCount: 3, sides: "outside_only" }).ruleVersion,
    PARTIAL_WINDOW_RULE_VERSION,
  );
});
Deno.test("clamps negative / fractional window counts", () => {
  assertEquals(computePartialWindowPrice({ windowCount: -2, sides: "outside_only" }).price, 0);
  assertEquals(computePartialWindowPrice({ windowCount: 2.7, sides: "outside_only" }).price, 20);
});