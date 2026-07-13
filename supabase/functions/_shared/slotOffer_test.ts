import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeQuoteSignature, buildOfferSlotId } from "./slotOffer.ts";

const baseQuote = {
  total: 200, ruleVersion: 1, engineVersion: "e1", estimatedDurationMinutes: 120,
  lineItems: [{ name: "window_cleaning", unitPrice: 200 }],
};

Deno.test("signature stable for identical quotes", () => {
  assertEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote }));
});
Deno.test("signature changes when total changes", () => {
  assertNotEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote, total: 250 }));
});
Deno.test("signature changes when duration changes", () => {
  assertNotEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote, estimatedDurationMinutes: 180 }));
});
Deno.test("signature changes when line items change", () => {
  assertNotEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote, lineItems: [{ name: "house_wash", unitPrice: 200 }] }));
});
Deno.test("slot ids are unique across offer versions (no stale-id collision)", () => {
  const a = [0, 1, 2].map((i) => buildOfferSlotId("abc", i));
  const b = [0, 1, 2].map((i) => buildOfferSlotId("def", i));
  for (const id of a) assert(!b.includes(id));
  assertEquals(a[0], "slot_abc_1");
});
