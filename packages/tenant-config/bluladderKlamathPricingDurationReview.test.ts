import { describe, expect, it } from "vitest";
import { BLULADDER_KLAMATH } from "./bluladderKlamath";
import {
  evaluateKlamathPricingDurationReview,
  KLAMATH_FIRST_WAVE_AUTOMATED_SERVICE_KEYS,
  KLAMATH_MANUAL_REVIEW_SERVICE_KEYS,
  KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE,
  KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT,
  KLAMATH_PRICING_DURATION_REVIEW_TEMPLATE,
  type KlamathPricingDurationReviewEnvelope,
} from "./bluladderKlamathPricingDurationReview";

function approvedFixture(): KlamathPricingDurationReviewEnvelope {
  return {
    candidate: structuredClone(KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE),
    candidateFingerprint: structuredClone(
      KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT,
    ),
    ownerApproval: {
      status: "approved",
      recordRef: "github-issue-151",
      approvedAt: "2026-08-14T15:00:00Z",
    },
    contractTestsPassed: true,
  };
}

describe("Klamath pricing and duration review", () => {
  it("keeps the repository template blocked", () => {
    expect(evaluateKlamathPricingDurationReview(
      KLAMATH_PRICING_DURATION_REVIEW_TEMPLATE,
    )).toEqual({
      status: "blocked",
      activationAllowed: false,
      blockers: ["contract_tests_not_verified", "owner_approval_missing"],
    });
  });

  it("can reach only the separate launch-input gate", () => {
    expect(evaluateKlamathPricingDurationReview(approvedFixture())).toEqual({
      status: "eligible_for_pricing_duration_gate",
      activationAllowed: false,
      blockers: [],
    });
  });

  it("binds owner approval to the canonical candidate fingerprint", () => {
    expect(KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE_FINGERPRINT).toEqual({
      algorithm: "sha256",
      serialization: "canonical_json_sorted_keys_pretty_2_trailing_newline",
      sha256:
        "d69f072d0510393304cc382ec0140c385a7d8bb2302b6ccdab7592149e1e21a4",
    });
    const fixture = approvedFixture();
    fixture.candidateFingerprint.sha256 = "0".repeat(64);
    expect(evaluateKlamathPricingDurationReview(fixture).blockers).toContain(
      "candidate_fingerprint_mismatch",
    );
  });

  it("binds the exact first wave and manual-review boundary", () => {
    expect(KLAMATH_FIRST_WAVE_AUTOMATED_SERVICE_KEYS).toEqual([
      "window_cleaning",
      "gutter_cleaning",
      "house_wash",
      "pressure_washing",
    ]);
    expect(KLAMATH_MANUAL_REVIEW_SERVICE_KEYS).toEqual([
      "solar_panel_cleaning",
      "christmas_lights",
      "commercial_exterior_cleaning",
      "storefront_window_cleaning",
    ]);
  });

  it("rejects pricing or duration drift", () => {
    const pricing = approvedFixture();
    pricing.candidate.pricing.window_cleaning.minimumPrice = 99;
    const duration = approvedFixture();
    duration.candidate.durationPolicy!.setupMinutes = 0;
    expect(evaluateKlamathPricingDurationReview(pricing).blockers)
      .toContain("candidate_snapshot_mismatch");
    expect(evaluateKlamathPricingDurationReview(duration).blockers)
      .toContain("candidate_snapshot_mismatch");
  });

  it("compares JSON objects semantically rather than by property order", () => {
    const fixture = approvedFixture();
    fixture.candidate = Object.fromEntries(
      Object.entries(fixture.candidate).reverse(),
    ) as unknown as KlamathPricingDurationReviewEnvelope["candidate"];
    expect(evaluateKlamathPricingDurationReview(fixture).blockers).not
      .toContain("candidate_snapshot_mismatch");
  });

  it("rejects invalid approval evidence and incomplete tests", () => {
    const fixture = approvedFixture();
    fixture.ownerApproval.recordRef = "private-chat";
    fixture.ownerApproval.approvedAt = "tomorrow";
    fixture.contractTestsPassed = false;
    expect(evaluateKlamathPricingDurationReview(fixture).blockers).toEqual(
      expect.arrayContaining([
        "owner_approval_invalid",
        "contract_tests_not_verified",
      ]),
    );
  });

  it("rejects sensitive or unrelated fields", () => {
    const fixture = approvedFixture() as unknown as Record<string, unknown>;
    fixture.activateNow = true;
    (fixture.ownerApproval as Record<string, unknown>).grantKey = "forbidden";
    expect(evaluateKlamathPricingDurationReview(fixture).blockers).toEqual(
      expect.arrayContaining([
        "unexpected_field:$.activateNow",
        "sensitive_field_present:$.ownerApproval.grantKey",
      ]),
    );
  });

  it("leaves every runtime and activation surface closed", () => {
    expect(BLULADDER_KLAMATH.pricing.status).toBe("draft");
    expect(BLULADDER_KLAMATH.pricing.runtimeEnabled).toBe(false);
    expect(BLULADDER_KLAMATH.activationAllowed).toBe(false);
    expect(BLULADDER_KLAMATH.customerTrafficAllowed).toBe(false);
    expect(KLAMATH_PRICING_DURATION_REVIEW_CANDIDATE).toMatchObject({
      promotion99Enabled: false,
      pricingRuntimeEnabled: false,
      activationAllowed: false,
    });
  });
});
