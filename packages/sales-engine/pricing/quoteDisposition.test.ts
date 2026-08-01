import { describe, expect, it } from "vitest";
import { resolveQuoteDisposition } from "./quoteDisposition";

describe("quote disposition policy boundary", () => {
  it("does not let mathematical firmness override unresolved policy", () => {
    expect(resolveQuoteDisposition({engineStatus:"firm", productPolicyStatus:"owner_decision_required", channelEligibility:"owner_decision_required"}).finalQuoteDisposition).toBe("owner_decision_required");
  });
  it("preserves engine manual review", () => {
    expect(resolveQuoteDisposition({engineStatus:"manual_review_required"}).finalQuoteDisposition).toBe("manual_review");
  });
});
