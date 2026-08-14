import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLULADDER_KLAMATH } from "./bluladderKlamath";
import {
  evaluateKlamathMessagingComplianceReview,
  KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE,
  KLAMATH_MESSAGING_COMPLIANCE_REVIEW_TEMPLATE,
  KLAMATH_SMS_SAMPLE_MESSAGES,
  KLAMATH_SMS_USE_CASES,
  type KlamathMessagingComplianceReviewEnvelope,
} from "./bluladderKlamathMessagingComplianceReview";

function approvedFixture(): KlamathMessagingComplianceReviewEnvelope {
  return {
    candidate: structuredClone(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE),
    ownerApproval: {
      status: "approved",
      recordRef: "github-issue-151",
      approvedAt: "2026-08-14T16:00:00Z",
    },
    legalReview: {
      status: "approved",
      recordRef: "legal-review-2026-08-14",
      approvedAt: "2026-08-14T16:01:00Z",
    },
    publicSurfacesVerified: true,
    providerUseCaseEligibilityVerified: true,
    contractTestsPassed: true,
  };
}

describe("Klamath messaging compliance review", () => {
  it("keeps the checked repository template semantically identical to the candidate", () => {
    const template = JSON.parse(readFileSync(path.join(
      process.cwd(),
      "docs/operations/bluladder-klamath-messaging-compliance-review.template.json",
    ), "utf8"));
    expect(template.candidate).toEqual(
      structuredClone(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE),
    );
  });

  it("keeps the repository template blocked", () => {
    expect(evaluateKlamathMessagingComplianceReview(
      KLAMATH_MESSAGING_COMPLIANCE_REVIEW_TEMPLATE,
    )).toEqual({
      status: "blocked",
      activationAllowed: false,
      blockers: [
        "contract_tests_not_verified",
        "legal_review_missing",
        "owner_review_missing",
        "provider_use_case_eligibility_not_verified",
        "public_surfaces_not_verified",
      ],
    });
  });

  it("can reach only the separate Twilio campaign-submission review", () => {
    expect(evaluateKlamathMessagingComplianceReview(approvedFixture())).toEqual({
      status: "eligible_for_twilio_campaign_submission_review",
      activationAllowed: false,
      blockers: [],
    });
  });

  it("binds the exact use cases and five representative samples", () => {
    expect(KLAMATH_SMS_USE_CASES).toEqual([
      "quote_link",
      "booking_management",
      "reminder",
      "operator_followup",
      "authentication",
    ]);
    expect(KLAMATH_SMS_SAMPLE_MESSAGES).toHaveLength(5);
    expect(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE.campaign)
      .toMatchObject({
        recommendedUseCaseCategory: "LOW_VOLUME",
        recommendationStatus: "pending_provider_eligibility_and_owner_review",
      });
    for (const message of KLAMATH_SMS_SAMPLE_MESSAGES) {
      expect(message.length).toBeGreaterThanOrEqual(20);
      expect(message.length).toBeLessThanOrEqual(1024);
      expect(message).toContain("BluLadder Klamath");
      expect(message).toContain("STOP");
    }
  });

  it("requires a separate unchecked marketing opt-in", () => {
    expect(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE.consent)
      .toMatchObject({
        marketingCheckboxDefaultChecked: false,
        consentRequiredForPurchase: false,
      });
    expect(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE.consent.messageFlow)
      .toContain("separate unchecked marketing opt-in");
  });

  it("rejects candidate copy, URL, or use-case drift", () => {
    const copy = approvedFixture();
    copy.candidate.consent.transactionalDisclosure = "Send anything.";
    const url = approvedFixture();
    url.candidate.publicSurfaces.privacyPolicyUrl = "https://example.com";
    const useCase = approvedFixture();
    useCase.candidate.campaign.useCases = ["quote_link"];
    for (const fixture of [copy, url, useCase]) {
      expect(evaluateKlamathMessagingComplianceReview(fixture).blockers)
        .toContain("candidate_snapshot_mismatch");
    }
  });

  it("rejects incomplete review evidence and unpublished surfaces", () => {
    const fixture = approvedFixture();
    fixture.ownerApproval.recordRef = "private-chat";
    fixture.legalReview.approvedAt = "tomorrow";
    fixture.publicSurfacesVerified = false;
    fixture.providerUseCaseEligibilityVerified = false;
    fixture.contractTestsPassed = false;
    expect(evaluateKlamathMessagingComplianceReview(fixture).blockers).toEqual(
      expect.arrayContaining([
        "owner_review_invalid",
        "legal_review_invalid",
        "public_surfaces_not_verified",
        "provider_use_case_eligibility_not_verified",
        "contract_tests_not_verified",
      ]),
    );
  });

  it("rejects sensitive or unrelated evidence fields", () => {
    const fixture = approvedFixture() as unknown as Record<string, unknown>;
    fixture.activateNow = true;
    (fixture.ownerApproval as Record<string, unknown>).apiKey = "forbidden";
    expect(evaluateKlamathMessagingComplianceReview(fixture).blockers).toEqual(
      expect.arrayContaining([
        "unexpected_field:$.activateNow",
        "sensitive_field_present:$.ownerApproval.apiKey",
      ]),
    );
  });

  it("leaves publication, provider submission, runtime, and activation closed", () => {
    expect(BLULADDER_KLAMATH.lifecycle).toBe("provisioning");
    expect(BLULADDER_KLAMATH.site.published).toBe(false);
    expect(BLULADDER_KLAMATH.site.runtimeRoutingEnabled).toBe(false);
    expect(BLULADDER_KLAMATH.customerTrafficAllowed).toBe(false);
    expect(BLULADDER_KLAMATH.activationAllowed).toBe(false);
    expect(KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE).toMatchObject({
      sourceImplementationChanged: false,
      publicSurfacesPublished: false,
      providerCampaignSubmitted: false,
      messagingRuntimeEnabled: false,
      customerTrafficAllowed: false,
      activationAllowed: false,
    });
  });
});
