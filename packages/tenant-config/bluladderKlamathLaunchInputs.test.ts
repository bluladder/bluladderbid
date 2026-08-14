import { describe, expect, it } from "vitest";
import {
  BLULADDER_KLAMATH_LAUNCH_INPUT_TEMPLATE,
  evaluateKlamathLaunchInputs,
  KLAMATH_EXPECTED_DRAFT_SNAPSHOT,
  KLAMATH_OWNER_DECISION_KEYS,
  KLAMATH_PROTECTED_PRESENCE_KEYS,
  KLAMATH_PROVIDER_GATE_KEYS,
  KLAMATH_RELEASE_GATE_KEYS,
  type KlamathLaunchInputEnvelope,
} from "./bluladderKlamathLaunchInputs";

function readyFixture(): KlamathLaunchInputEnvelope {
  const fixture: KlamathLaunchInputEnvelope = {
    schemaVersion: 1,
    tenantKey: "bluladder-klamath",
    purpose: "activation_review",
    draftSnapshot: structuredClone(KLAMATH_EXPECTED_DRAFT_SNAPSHOT),
    ownerApprovals: Object.fromEntries(
      KLAMATH_OWNER_DECISION_KEYS.map((key) => [key, {
        status: "approved",
        recordRef: "github-issue-151",
        approvedAt: "2026-08-14T14:00:00Z",
      }]),
    ) as KlamathLaunchInputEnvelope["ownerApprovals"],
    protectedConfigurationPresence: Object.fromEntries(
      KLAMATH_PROTECTED_PRESENCE_KEYS.map((key) => [key, true]),
    ) as KlamathLaunchInputEnvelope["protectedConfigurationPresence"],
    providerReadiness: Object.fromEntries(
      KLAMATH_PROVIDER_GATE_KEYS.map((key) => [key, true]),
    ) as KlamathLaunchInputEnvelope["providerReadiness"],
    releaseEvidence: Object.fromEntries(
      KLAMATH_RELEASE_GATE_KEYS.map((key) => [key, true]),
    ) as KlamathLaunchInputEnvelope["releaseEvidence"],
  };
  fixture.draftSnapshot.businessHours.activeDays = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
  ];
  return fixture;
}

describe("Klamath launch-input readiness", () => {
  it("keeps the repository template blocked without protected values", () => {
    const result = evaluateKlamathLaunchInputs(
      BLULADDER_KLAMATH_LAUNCH_INPUT_TEMPLATE,
    );

    expect(result.status).toBe("blocked");
    expect(result.activationAllowed).toBe(false);
    expect(result.blockers).toContain("owner_approval_missing:business_hours");
    expect(result.blockers).toContain("business_hours_active_days_invalid");
    expect(result.blockers).toContain(
      "protected_configuration_missing:public_customer_contact",
    );
    expect(result.blockers).toContain(
      "provider_gate_incomplete:jobtread_grant_present",
    );
  });

  it("can reach only a separate activation review", () => {
    expect(evaluateKlamathLaunchInputs(readyFixture())).toEqual({
      status: "eligible_for_activation_review",
      activationAllowed: false,
      blockers: [],
    });
  });

  it("rejects invalid active weekdays and business-hours authority drift", () => {
    const fixture = readyFixture();
    fixture.draftSnapshot.businessHours.activeDays = ["funday"];
    fixture.draftSnapshot.businessHours.localOpen = "08:00";
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toEqual(
      expect.arrayContaining([
        "business_hours_active_days_invalid",
        "draft_snapshot_mismatch:businessHours",
      ]),
    );
  });

  it("rejects pricing, provider, and DFW-fallback draft drift", () => {
    const fixture = readyFixture();
    fixture.draftSnapshot.pricingAndBooking.horizonDays = 30;
    fixture.draftSnapshot.jobtread.dfwJobberFallbackAllowed = true as false;
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toEqual(
      expect.arrayContaining([
        "draft_snapshot_mismatch:jobtread",
        "draft_snapshot_mismatch:pricingAndBooking",
      ]),
    );
  });

  it("rejects an approval without a bounded non-sensitive record", () => {
    const fixture = readyFixture();
    fixture.ownerApprovals.pricing_and_booking.recordRef = "private-chat";
    fixture.ownerApprovals.pricing_and_booking.approvedAt = "tomorrow";
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toContain(
      "owner_approval_invalid:pricing_and_booking",
    );
  });

  it("rejects protected configuration gaps without accepting values", () => {
    const fixture = readyFixture();
    fixture.protectedConfigurationPresence.voice_transfer_recipient = false;
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toContain(
      "protected_configuration_missing:voice_transfer_recipient",
    );
  });

  it("rejects every incomplete provider and release gate", () => {
    const fixture = readyFixture();
    fixture.providerReadiness.jobtread_server_initiated_mode_verified = false;
    fixture.providerReadiness.twilio_campaign_approved = false;
    fixture.releaseEvidence.controlled_qa_passed = false;
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toEqual(
      expect.arrayContaining([
        "provider_gate_incomplete:jobtread_server_initiated_mode_verified",
        "provider_gate_incomplete:twilio_campaign_approved",
        "release_gate_incomplete:controlled_qa_passed",
      ]),
    );
  });

  it("rejects provider identifiers and secret-like extra fields", () => {
    const fixture = readyFixture() as unknown as Record<string, unknown>;
    (fixture.providerReadiness as Record<string, unknown>).providerId =
      "must-not-be-accepted";
    (fixture.protectedConfigurationPresence as Record<string, unknown>)
      .secret = "must-not-be-accepted";
    expect(evaluateKlamathLaunchInputs(fixture).blockers).toEqual(
      expect.arrayContaining([
        "sensitive_field_present:$.providerReadiness.providerId",
        "sensitive_field_present:$.protectedConfigurationPresence.secret",
      ]),
    );
  });

  it("rejects unrelated extra fields at every structured boundary", () => {
    const fixture = readyFixture() as unknown as Record<string, unknown>;
    fixture.activateNow = true;
    (fixture.draftSnapshot as Record<string, unknown>).pricing = {};
    const result = evaluateKlamathLaunchInputs(fixture);
    expect(result.blockers).toEqual(expect.arrayContaining([
      "unexpected_field:$.activateNow",
      "unexpected_field:$.draftSnapshot.pricing",
    ]));
    expect(result.activationAllowed).toBe(false);
  });

  it("fails closed for malformed or missing input", () => {
    expect(evaluateKlamathLaunchInputs(null)).toMatchObject({
      status: "blocked",
      activationAllowed: false,
    });
    expect(evaluateKlamathLaunchInputs({}).blockers).toEqual(
      expect.arrayContaining([
        "schema_version_invalid",
        "tenant_mismatch",
        "purpose_invalid",
      ]),
    );
  });
});
