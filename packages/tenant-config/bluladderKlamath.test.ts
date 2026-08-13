import { describe, expect, it } from "vitest";
import { LIVE_CONFIG } from "../../src/lib/pricing/__fixtures__/liveConfig";
import {
  BLULADDER_KLAMATH,
  BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
  BLULADDER_KLAMATH_SITE_AUTHORITY,
  BLULADDER_KLAMATH_TENANT_KEY,
} from "./bluladderKlamath";
import {
  BLULADDER_KLAMATH_PRICING_DRAFT,
  BLULADDER_KLAMATH_TRAVEL_DRAFT,
} from "./bluladderKlamathPricingDraft";
import {
  resolveTenantSiteAuthority,
  type TenantSiteAuthorityRecord,
} from "./siteAuthority";

const ACTIVE_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000106";

function activeRecord(
  overrides: Partial<TenantSiteAuthorityRecord> = {},
): TenantSiteAuthorityRecord {
  return {
    ...BLULADDER_KLAMATH_SITE_AUTHORITY,
    organizationId: ACTIVE_ORGANIZATION_ID,
    organizationLifecycle: "active",
    mappingStatus: "active",
    runtimeRoutingEnabled: true,
    ...overrides,
  };
}

describe("BluLadder Klamath Phase 1A configuration", () => {
  it("remains inactive and independent from the DFW runtime", () => {
    expect(BLULADDER_KLAMATH).toMatchObject({
      tenantKey: BLULADDER_KLAMATH_TENANT_KEY,
      customerFacingName: "BluLadder Klamath",
      organizationId: null,
      lifecycle: "provisioning",
      activationAllowed: false,
      customerTrafficAllowed: false,
      dfwFallbackAllowed: false,
      site: {
        canonicalHostname: "klamath.bluladder.com",
        aliases: [],
        mappingStatus: "unprovisioned",
        runtimeRoutingEnabled: false,
        published: false,
      },
    });
    expect(BLULADDER_KLAMATH.pricing.runtimeEnabled).toBe(false);
    expect(BLULADDER_KLAMATH.crm.dfwJobberFallbackAllowed).toBe(false);
  });

  it("records the independent business configuration without credentials or contacts", () => {
    expect(BLULADDER_KLAMATH.locale.timezone).toBe("America/Los_Angeles");
    expect(BLULADDER_KLAMATH.territory.countyRules).toHaveLength(2);
    expect(BLULADDER_KLAMATH.territory.countyRules.every((rule) =>
      rule.status === "inactive"
    )).toBe(true);
    expect(BLULADDER_KLAMATH.businessHours).toMatchObject({
      localOpen: "09:00",
      localClose: "17:00",
      activeDays: [],
      status: "owner_confirmation_required",
    });
    expect(BLULADDER_KLAMATH.booking.instantConfirmationEnabled).toBe(false);
    expect(BLULADDER_KLAMATH.crm).toMatchObject({
      provider: "jobtread",
      connectorStatus: "unverified",
      credentialConfigured: false,
    });
    expect(BLULADDER_KLAMATH.communications).toMatchObject({
      carrier: "twilio",
      primaryNumberCapabilities: ["voice", "sms"],
      numberProvisioned: false,
      messagingRegistrationStatus: "not_started",
      vapiImportStatus: "not_started",
    });
    expect(BLULADDER_KLAMATH.contactRoles.every((role) =>
      role.required && !role.configured
    )).toBe(true);
  });

  it("copies the DFW numeric baseline into an independent inactive draft", () => {
    expect(BLULADDER_KLAMATH_PRICING_DRAFT).not.toBe(LIVE_CONFIG);
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.window_cleaning)
      .toEqual(LIVE_CONFIG.window_cleaning);
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.house_wash)
      .toEqual(LIVE_CONFIG.house_wash);
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.gutter_cleaning)
      .toEqual(LIVE_CONFIG.gutter_cleaning);
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.pressure_washing)
      .toEqual(LIVE_CONFIG.pressure_washing);
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.tax_policy).toMatchObject({
      rate: 0,
      exemptLineItemKeys: [],
    });
    expect(BLULADDER_KLAMATH_PRICING_DRAFT.window_promo_99?.active)
      .toBe(false);
    expect(BLULADDER_KLAMATH_TRAVEL_DRAFT).toMatchObject({
      status: "manual_review",
      includedOneWayMinutes: 45,
      waiveChargeAtSubtotal: 500,
      proposedFlatCharge: 100,
      mileageRate: null,
    });
  });
});

describe("tenant site authority", () => {
  it("blocks the current unprovisioned Klamath mapping", () => {
    expect(resolveTenantSiteAuthority(
      BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
      [BLULADDER_KLAMATH_SITE_AUTHORITY],
    )).toMatchObject({
      status: "blocked",
      code: "site_mapping_unavailable",
    });
  });

  it("resolves one exact active server-supplied mapping", () => {
    expect(resolveTenantSiteAuthority(
      "KLAMATH.BLULADDER.COM:443",
      [activeRecord()],
    )).toEqual({
      status: "resolved",
      tenantKey: BLULADDER_KLAMATH_TENANT_KEY,
      organizationId: ACTIVE_ORGANIZATION_ID,
      hostname: BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
    });
  });

  it("does not accept aliases, paths, or an Oregon fallback hostname", () => {
    for (const hostname of [
      "oregon.bluladder.com",
      "www.klamath.bluladder.com",
      "https://klamath.bluladder.com",
      "klamath.bluladder.com/path",
      "klamath.bluladder.com:0",
      "klamath.bluladder.com:99999",
    ]) {
      expect(resolveTenantSiteAuthority(hostname, [activeRecord()]).status)
        .toBe("blocked");
    }
  });

  it("fails closed for ambiguous, inactive, or runtime-disabled mappings", () => {
    expect(resolveTenantSiteAuthority(
      BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
      [activeRecord(), activeRecord()],
    )).toMatchObject({ status: "blocked", code: "ambiguous_site_mapping" });
    expect(resolveTenantSiteAuthority(
      BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
      [activeRecord({ organizationLifecycle: "provisioning" })],
    )).toMatchObject({ status: "blocked", code: "organization_inactive" });
    expect(resolveTenantSiteAuthority(
      BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
      [activeRecord({ runtimeRoutingEnabled: false })],
    )).toMatchObject({
      status: "blocked",
      code: "runtime_routing_disabled",
    });
  });
});
