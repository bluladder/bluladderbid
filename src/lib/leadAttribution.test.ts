import { describe, expect, it } from "vitest";
import {
  buildJobberLeadSourcePayload,
  mergeAttribution,
  normalizeLeadSource,
  validateLeadSourceSelection,
  type LeadSourceDefinition,
} from "./leadAttribution";

const definitions: LeadSourceDefinition[] = [
  {
    sourceKey: "google_business_profile",
    displayName: "Google Maps / Google Business Profile",
    aliases: ["Google Maps", "GBP"],
    isActive: true,
  },
  {
    sourceKey: "other",
    displayName: "Other",
    aliases: [],
    isOther: true,
    isActive: true,
  },
];

describe("lead attribution", () => {
  it("normalizes display names and aliases", () => {
    expect(normalizeLeadSource("  gbp ", definitions)).toBe("google_business_profile");
    expect(normalizeLeadSource("Google Maps / Google Business Profile", definitions)).toBe("google_business_profile");
  });

  it("requires detail when Other is selected", () => {
    expect(validateLeadSourceSelection({ sourceKey: "other", definitions })).toEqual({
      valid: false,
      reason: "detail_required",
    });
    expect(validateLeadSourceSelection({ sourceKey: "other", sourceDetail: "Church bulletin", definitions })).toEqual({
      valid: true,
    });
  });

  it("preserves first touch while replacing last touch", () => {
    const merged = mergeAttribution(
      {
        selfReportedSource: null,
        selfReportedSourceDetail: null,
        normalizedSourceKey: null,
        attributionSource: "google",
        attributionMedium: "cpc",
        attributionCampaign: "spring",
        attributionContent: null,
        firstTouch: { source: "google", capturedAt: "2026-01-01T00:00:00Z" },
        lastTouch: { source: "google", capturedAt: "2026-01-01T00:00:00Z" },
        callrailTrackingNumber: null,
        callrailCampaign: null,
      },
      {
        attributionSource: "facebook",
        lastTouch: { source: "facebook", capturedAt: "2026-01-02T00:00:00Z" },
      },
    );

    expect(merged.firstTouch?.source).toBe("google");
    expect(merged.lastTouch?.source).toBe("facebook");
    expect(merged.attributionSource).toBe("facebook");
  });

  it("builds deterministic Jobber idempotency keys", () => {
    const attribution = mergeAttribution(null, {
      normalizedSourceKey: "google_business_profile",
      selfReportedSourceDetail: "Maps",
    });

    const first = buildJobberLeadSourcePayload({
      entityType: "booking",
      entityId: "booking-123",
      attribution,
      mappingMode: "internal_note",
    });
    const second = buildJobberLeadSourcePayload({
      entityType: "booking",
      entityId: "booking-123",
      attribution,
      mappingMode: "internal_note",
    });

    expect(first.idempotencyKey).toBe(second.idempotencyKey);
    expect(first.payload).toEqual({
      note: "BluLadder lead source: google_business_profile: Maps",
    });
  });

  it("uses a documented custom-field fallback", () => {
    const attribution = mergeAttribution(null, {
      normalizedSourceKey: "google_business_profile",
    });

    expect(buildJobberLeadSourcePayload({
      entityType: "customer",
      entityId: "customer-1",
      attribution,
      mappingMode: "custom_field",
    })).toMatchObject({
      mode: "custom_field",
      payload: {
        customFieldKey: "bluladder_lead_source",
        value: "google_business_profile",
      },
    });
  });
});
