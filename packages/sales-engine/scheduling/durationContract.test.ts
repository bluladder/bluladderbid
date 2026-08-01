import { describe, expect, it } from "vitest";
import { resolveAuthoritativeDuration } from "./durationContract";

describe("authoritative duration contract", () => {
  it.each([null, {}, {estimatedDurationMinutes:null}, {estimatedDurationMinutes:0}])("returns unavailable without guessing", (quote) => {
    expect(resolveAuthoritativeDuration(quote).status).toBe("unavailable");
  });
  it("accepts a positive authoritative duration", () => {
    expect(resolveAuthoritativeDuration({estimatedDurationMinutes:90})).toMatchObject({status:"available",minutes:90});
  });
  it("blocks manual-review-only work but accepts a separately bookable firm portion", () => {
    expect(resolveAuthoritativeDuration({ status:"manual_review_required", estimatedDurationMinutes:90 })).toMatchObject({status:"manual_review_required",minutes:null});
    expect(resolveAuthoritativeDuration({ status:"manual_review_required", estimatedDurationMinutes:90, bookableServiceKeys:["window_cleaning"], durationSource:"deterministic_duration_engine" })).toMatchObject({status:"available",minutes:90});
  });
});
