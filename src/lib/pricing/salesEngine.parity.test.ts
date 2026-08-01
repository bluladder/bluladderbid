import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Sales Engine generated mirrors", () => {
  it.each([
    ["packages/sales-engine/intake/quoteIntakeContract.ts", "supabase/functions/_shared/salesEngine/quoteIntakeContract.ts"],
    ["packages/sales-engine/intake/residentialQuoteManifest.ts", "supabase/functions/_shared/salesEngine/residentialQuoteManifest.ts"],
    ["packages/sales-engine/pricing/quoteDisposition.ts", "supabase/functions/_shared/salesEngine/quoteDisposition.ts"],
    ["packages/sales-engine/scheduling/durationContract.ts", "supabase/functions/_shared/salesEngine/durationContract.ts"],
  ])("keeps %s synchronized", (source, mirror) => {
    expect(readFileSync(resolve(mirror), "utf8")).toBe(readFileSync(resolve(source), "utf8"));
  });
});
