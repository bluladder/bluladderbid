import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Enforces that the server copy of the pricing engine stays byte-identical to
 * the canonical frontend copy. This guarantees ONE source of truth for pricing
 * math across the website and all edge functions.
 */
describe("pricing engine parity", () => {
  it("frontend and edge-function engine are byte-identical", () => {
    const front = readFileSync(resolve(__dirname, "engine.ts"), "utf8");
    const server = readFileSync(
      resolve(__dirname, "../../../supabase/functions/_shared/pricingEngine.ts"),
      "utf8",
    );
    expect(server).toBe(front);
  });
});