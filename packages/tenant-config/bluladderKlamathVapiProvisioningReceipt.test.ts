import { describe, expect, it } from "vitest";
import {
  evaluateKlamathVapiProvisioningReceipt,
  KLAMATH_VAPI_APPROVED_MANIFEST_SHA256,
  KLAMATH_VAPI_PROVISIONING_RECEIPT_TEMPLATE,
  type KlamathVapiProvisioningReceipt,
} from "./bluladderKlamathVapiProvisioningReceipt";

function verifiedFixture(): KlamathVapiProvisioningReceipt {
  return {
    ...structuredClone(KLAMATH_VAPI_PROVISIONING_RECEIPT_TEMPLATE),
    status: "verified",
    observedAt: "2026-08-21T05:00:00Z",
    assistant: {
      uniqueMatchCount: 1,
      creationSucceeded: true,
      savedStateVerified: true,
      configurationMatched: true,
      identityFingerprintSha256: "a".repeat(64),
      providerVersionMarker: "v1",
      driftPaths: [],
    },
    phone: {
      uniqueMatchCount: 1,
      importSucceeded: true,
      voiceOnly: true,
      smsDisabled: true,
      assistantBindingAbsent: true,
      identityFingerprintSha256: "b".repeat(64),
    },
    safeguards: {
      nonKlamathResourcesPreserved: true,
      twilioMessagingConfigurationUnchanged: true,
      temporaryVapiKeyRevoked: true,
      containsProviderIdentifiers: false,
      containsPhoneDigits: false,
      containsCredentials: false,
      containsHeaders: false,
      containsServerUrls: false,
      containsRecipientDetails: false,
      containsCustomerData: false,
      containsMessageContents: false,
    },
    blockerCodes: [],
    nextGate: "hosted_tenant_binding_review",
  };
}

describe("Klamath Vapi provisioning receipt", () => {
  it("keeps the repository template pending and activation closed", () => {
    expect(evaluateKlamathVapiProvisioningReceipt(
      KLAMATH_VAPI_PROVISIONING_RECEIPT_TEMPLATE,
    )).toEqual({
      status: "blocked",
      activationAllowed: false,
      blockers: ["provisioning_evidence_pending"],
    });
  });

  it("can reach only the hosted tenant-binding review", () => {
    expect(evaluateKlamathVapiProvisioningReceipt(verifiedFixture())).toEqual({
      status: "eligible_for_hosted_binding_review",
      activationAllowed: false,
      blockers: [],
    });
  });

  it("binds evidence to the exact owner-approved manifest digest", () => {
    expect(KLAMATH_VAPI_APPROVED_MANIFEST_SHA256).toBe(
      "e35e56efca6160be37c1cb35cf213b2aa8f1f66cb82351e6c3c5ee09aa4c47c4",
    );
    const fixture = verifiedFixture();
    fixture.manifestSourceSha256 = "0".repeat(64);
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toContain(
      "receipt_identity_invalid",
    );
  });

  it("rejects raw provider, phone, URL, credential, and message evidence", () => {
    const fixture = verifiedFixture() as unknown as Record<string, unknown>;
    fixture.assistantId = "123e4567-e89b-12d3-a456-426614174000";
    fixture.phoneNumber = "+15415550123";
    fixture.serverUrl = "https://example.invalid/webhook";
    fixture.authorization = "Bearer should-never-appear";
    fixture.messageContent = "customer text";
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toEqual(
      expect.arrayContaining([
        "prohibited_field:$.assistantId",
        "prohibited_value:$.assistantId",
        "prohibited_field:$.phoneNumber",
        "prohibited_value:$.phoneNumber",
        "prohibited_field:$.serverUrl",
        "prohibited_value:$.serverUrl",
        "prohibited_field:$.authorization",
        "prohibited_value:$.authorization",
        "prohibited_field:$.messageContent",
      ]),
    );
  });

  it("rejects serializer drift and unsafe phone state", () => {
    const fixture = verifiedFixture();
    fixture.assistant.driftPaths = ["$.transcriber"];
    fixture.phone.smsDisabled = false;
    fixture.phone.assistantBindingAbsent = false;
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toEqual(
      expect.arrayContaining([
        "assistant_evidence_invalid",
        "phone_evidence_invalid",
      ]),
    );
  });

  it("rejects customer actions and any opened launch gate", () => {
    const fixture = verifiedFixture();
    fixture.customerActionCounts.calls = 1;
    fixture.activationAllowed = true as false;
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toEqual(
      expect.arrayContaining([
        "customer_action_detected",
        "repository_activation_boundary_open",
      ]),
    );
  });

  it("rejects unverifiable fingerprints and an incomplete safe-state proof", () => {
    const fixture = verifiedFixture();
    fixture.assistant.identityFingerprintSha256 = "not-a-hash";
    fixture.phone.identityFingerprintSha256 = "also-not-a-hash";
    fixture.safeguards.temporaryVapiKeyRevoked = false;
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toEqual(
      expect.arrayContaining([
        "assistant_evidence_invalid",
        "phone_evidence_invalid",
        "safeguard_evidence_invalid",
      ]),
    );
  });

  it("rejects free-form status metadata", () => {
    const fixture = verifiedFixture();
    fixture.assistant.driftPaths = ["customer said something private"];
    fixture.blockerCodes = ["provider returned full response text"];
    expect(evaluateKlamathVapiProvisioningReceipt(fixture).blockers).toEqual(
      expect.arrayContaining([
        "unsafe_drift_path",
        "unsafe_blocker_code",
      ]),
    );
  });
});
