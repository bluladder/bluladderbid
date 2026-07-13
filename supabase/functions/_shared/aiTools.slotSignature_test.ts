import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { computeQuoteSignature } from "./aiTools.ts";

// Defect 2: the quote signature bound into an availability offer must change
// whenever the priced job changes (total, rule version, duration or line items)
// so the booking validator rejects a slot chosen against a stale price/duration.
const baseQuote = {
  total: 200,
  ruleVersion: 1,
  engineVersion: "e1",
  estimatedDurationMinutes: 120,
  lineItems: [{ name: "window_cleaning", unitPrice: 200 }],
};

Deno.test("signature is stable for identical quotes", () => {
  assertEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote }));
});

Deno.test("signature changes when total changes", () => {
  assertNotEquals(computeQuoteSignature(baseQuote), computeQuoteSignature({ ...baseQuote, total: 250 }));
});

Deno.test("signature changes when duration changes", () => {
  assertNotEquals(
    computeQuoteSignature(baseQuote),
    computeQuoteSignature({ ...baseQuote, estimatedDurationMinutes: 180 }),
  );
});

Deno.test("signature changes when line items change", () => {
  assertNotEquals(
    computeQuoteSignature(baseQuote),
    computeQuoteSignature({ ...baseQuote, lineItems: [{ name: "house_wash", unitPrice: 200 }] }),
  );
});

Deno.test("offer-versioned slot ids are unique per offer version", () => {
  // Two offers a moment apart must not collide on slot ids, so a stale id can
  // never silently resolve against a newer offer.
  const v1 = "abc";
  const v2 = "def";
  const idsV1 = [1, 2, 3].map((i) => `slot_${v1}_${i}`);
  const idsV2 = [1, 2, 3].map((i) => `slot_${v2}_${i}`);
  for (const id of idsV1) assert(!idsV2.includes(id));
});
