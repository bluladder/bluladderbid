import { describe, expect, it } from "vitest";
import { resolveAuthoritativeDuration } from "./durationContract";

describe("authoritative duration contract", () => {
  it.each([null, {}, {estimatedDurationMinutes:null}, {estimatedDurationMinutes:0}])("returns unavailable without guessing", (quote) => {
    expect(resolveAuthoritativeDuration(quote).status).toBe("unavailable");
  });
  it("accepts a positive authoritative duration", () => {
    expect(resolveAuthoritativeDuration({estimatedDurationMinutes:90})).toMatchObject({status:"available",minutes:90});
  });
});
