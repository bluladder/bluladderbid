import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyWindowIntent,
  needsScopeClarification,
  normalizeWindowSides,
  WINDOW_SIDES_QUESTION,
} from "./windowIntent.ts";

const winCtx = { activeServices: ["windowCleaning"] };

Deno.test("normalizeWindowSides: 'outside only' → outside_only when window cleaning active", () => {
  assertEquals(normalizeWindowSides("outside only please", winCtx), "outside_only");
  assertEquals(normalizeWindowSides("just the outsides", winCtx), "outside_only");
  assertEquals(normalizeWindowSides("exterior glass only", winCtx), "outside_only");
});

Deno.test("normalizeWindowSides: 'inside and outside' → inside_and_outside", () => {
  assertEquals(normalizeWindowSides("inside and outside", winCtx), "inside_and_outside");
  assertEquals(normalizeWindowSides("both sides", winCtx), "inside_and_outside");
  assertEquals(normalizeWindowSides("full service", winCtx), "inside_and_outside");
});

Deno.test("normalizeWindowSides: 'exterior only' is NOT globally interpreted", () => {
  assertEquals(normalizeWindowSides("exterior only", { activeServices: ["houseWash"] }), null);
  assertEquals(normalizeWindowSides("exterior only", {}), null);
});

Deno.test("classifyWindowIntent: whole-home markers", () => {
  const p = classifyWindowIntent("I need my whole house done", winCtx);
  assertEquals(p.windowCleaningScope, "whole_home");
  assertEquals(p.customerType, "residential");
});

Deno.test("classifyWindowIntent: 'I don't want my whole house cleaned' → partial", () => {
  const p = classifyWindowIntent("I don't want my whole house cleaned", winCtx);
  assertEquals(p.windowCleaningScope, "partial");
});

Deno.test("classifyWindowIntent: 'only the front six windows' captures partial + area + count", () => {
  const p = classifyWindowIntent("Only the front six windows please", winCtx);
  assertEquals(p.windowCleaningScope, "partial");
  assertEquals(p.windowCount, 6);
  assert(p.partialAreas?.includes("front"));
});

Deno.test("classifyWindowIntent: 'clean three windows upstairs' captures partial", () => {
  const p = classifyWindowIntent("Can you clean three windows upstairs?", winCtx);
  assertEquals(p.windowCleaningScope, "partial");
  assertEquals(p.windowCount, 3);
  assert(p.partialAreas?.includes("upstairs"));
});

Deno.test("classifyWindowIntent: commercial keywords select commercial_custom", () => {
  const p = classifyWindowIntent("I run a dental office and need the windows cleaned", winCtx);
  assertEquals(p.customerType, "commercial");
  assertEquals(p.windowCleaningScope, "commercial_custom");
  assertEquals(p.commercialPropertyType, "dental office");
});

Deno.test("classifyWindowIntent: two storefronts with monthly outside-only", () => {
  const p = classifyWindowIntent(
    "I have two storefronts in McKinney and Frisco and want the outside glass done monthly",
    winCtx,
  );
  assertEquals(p.customerType, "commercial");
  assertEquals(p.windowCleaningScope, "commercial_custom");
  assertEquals(p.windowCleaningSides, "outside_only");
});

Deno.test("classifyWindowIntent: pure ambiguous request produces no scope", () => {
  const p = classifyWindowIntent("Can I get a quote", winCtx);
  assertEquals(p.windowCleaningScope, undefined);
});

Deno.test("needsScopeClarification: only when window cleaning active and scope unknown", () => {
  assertEquals(needsScopeClarification(["windowCleaning"], undefined), true);
  assertEquals(needsScopeClarification(["windowCleaning"], "whole_home"), false);
  assertEquals(needsScopeClarification(["houseWash"], undefined), false);
});

Deno.test("WINDOW_SIDES_QUESTION explicitly names window cleaning", () => {
  assert(/window cleaning/i.test(WINDOW_SIDES_QUESTION));
});