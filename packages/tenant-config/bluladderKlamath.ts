import type { TenantBusinessConfiguration } from "./contracts";
import {
  BLULADDER_KLAMATH_PRICING_PROFILE_KEY,
  BLULADDER_KLAMATH_TRAVEL_POLICY,
} from "./bluladderKlamathPricingDraft";
import type { TenantSiteAuthorityRecord } from "./siteAuthority";

export const BLULADDER_KLAMATH_TENANT_KEY = "bluladder-klamath";
export const BLULADDER_KLAMATH_ORGANIZATION_ID =
  "b1addf00-0000-4000-8000-000000000003";
export const BLULADDER_KLAMATH_CANONICAL_HOSTNAME =
  "klamath.bluladder.com";

const REQUIRED_CONTACT_ROLES: TenantBusinessConfiguration["contactRoles"][number]["role"][] =
  [
    "local_manager",
    "public_customer_contact",
    "voice_transfer_recipient",
    "sms_alert_recipient",
    "email_alert_recipient",
  ];

/**
 * Phase 1A repository authority for the future Klamath tenant. All activation
 * surfaces fail closed until hosted provisioning and later release gates are
 * independently verified.
 */
export const BLULADDER_KLAMATH: TenantBusinessConfiguration = {
  schemaVersion: 1,
  tenantKey: BLULADDER_KLAMATH_TENANT_KEY,
  customerFacingName: "BluLadder Klamath",
  organizationId: BLULADDER_KLAMATH_ORGANIZATION_ID,
  lifecycle: "provisioning",
  activationAllowed: false,
  customerTrafficAllowed: false,
  dfwFallbackAllowed: false,
  site: {
    canonicalHostname: BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
    aliases: [],
    mappingStatus: "provisioning",
    runtimeRoutingEnabled: false,
    published: false,
  },
  branding: {
    publicName: "BluLadder Klamath",
    legalName: null,
    tagline: "Next Level Clean",
    primaryColor: "#1B5FAC",
    accentColor: "#00CFFF",
    headingFont: "Montserrat Extra Bold",
  },
  locale: {
    timezone: "America/Los_Angeles",
    locale: "en-US",
    currencyCode: "USD",
  },
  territory: {
    countryCode: "US",
    stateCode: "OR",
    countyRules: [
      {
        key: "or-klamath-county",
        kind: "county",
        stateCode: "OR",
        countyName: "Klamath",
        effect: "include",
        status: "inactive",
      },
      {
        key: "or-lake-county",
        kind: "county",
        stateCode: "OR",
        countyName: "Lake",
        effect: "include",
        status: "inactive",
      },
    ],
    communities: [
      "Klamath Falls",
      "Lakeview",
      "Keno",
      "Bly",
      "Bonanza",
      "Chiloquin",
      "Sprague River",
      "Malin",
      "Merrill",
    ],
    operatingBases: ["Klamath Falls", "Bly"],
  },
  services: [
    {
      serviceKey: "window_cleaning",
      displayName: "Window Cleaning",
      market: "residential",
      availability: "planned",
      status: "inactive",
      reason: "Requires pricing approval and hosted activation.",
    },
    {
      serviceKey: "gutter_cleaning",
      displayName: "Gutter Cleaning",
      market: "residential",
      availability: "planned",
      status: "inactive",
      reason: "Requires pricing approval and hosted activation.",
    },
    {
      serviceKey: "house_wash",
      displayName: "House Washing",
      market: "residential",
      availability: "planned",
      status: "inactive",
      reason: "Requires pricing approval and hosted activation.",
    },
    {
      serviceKey: "pressure_washing",
      displayName: "Pressure Washing and Flatwork",
      market: "residential",
      availability: "planned",
      status: "inactive",
      reason: "Requires pricing approval and hosted activation.",
    },
    {
      serviceKey: "solar_panel_cleaning",
      displayName: "Solar-Panel Cleaning",
      market: "residential",
      availability: "manual_review",
      status: "inactive",
      reason:
        "Exact Klamath pricing, duration, access, and safety scope require separate approval.",
    },
    {
      serviceKey: "christmas_lights",
      displayName: "Christmas-Light Installation",
      market: "residential",
      availability: "manual_review",
      status: "inactive",
      reason:
        "Seasonal pricing, duration, calendar, and scope require separate approval.",
    },
    {
      serviceKey: "commercial_exterior_cleaning",
      displayName: "Commercial Exterior Cleaning",
      market: "commercial",
      availability: "manual_review",
      status: "inactive",
      reason: "Commercial scope and pricing are not approved for automation.",
    },
    {
      serviceKey: "storefront_window_cleaning",
      displayName: "Storefront Window Cleaning",
      market: "storefront",
      availability: "manual_review",
      status: "inactive",
      reason: "Storefront scope and pricing are not approved for automation.",
    },
  ],
  businessHours: {
    timezone: "America/Los_Angeles",
    localOpen: "09:00",
    localClose: "17:00",
    activeDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    status: "approved",
  },
  booking: {
    minimumNoticeHours: 48,
    horizonDays: 370,
    cancellationNoticeHours: 48,
    quoteExpiryDays: 30,
    paymentTiming: "after_service",
    depositRequired: false,
    instantConfirmationEnabled: false,
  },
  crm: {
    provider: "jobtread",
    connectorStatus: "unverified",
    credentialConfigured: false,
    dfwJobberFallbackAllowed: false,
  },
  communications: {
    carrier: "twilio",
    primaryNumberCapabilities: ["voice", "sms"],
    numberProvisioned: false,
    messagingRegistrationStatus: "not_started",
    vapiImportStatus: "not_started",
    voiceTransferUsesSeparateDestination: true,
  },
  contactRoles: REQUIRED_CONTACT_ROLES.map((role) => ({
    role,
    required: true,
    configured: false,
  })),
  pricing: {
    profileKey: BLULADDER_KLAMATH_PRICING_PROFILE_KEY,
    version: 1,
    status: "draft",
    runtimeEnabled: false,
    copiedFrom:
      "dfw-canonical-pricing-snapshot@9fd53d4458996f352e99dd6fbc679c435ee83793",
    taxPolicy: "oregon_no_general_sales_tax",
    travelPolicyStatus: BLULADDER_KLAMATH_TRAVEL_POLICY.status,
  },
};

export const BLULADDER_KLAMATH_SITE_AUTHORITY: TenantSiteAuthorityRecord = {
  tenantKey: BLULADDER_KLAMATH.tenantKey,
  organizationId: BLULADDER_KLAMATH.organizationId,
  organizationLifecycle: BLULADDER_KLAMATH.lifecycle,
  hostname: BLULADDER_KLAMATH.site.canonicalHostname,
  mappingStatus: BLULADDER_KLAMATH.site.mappingStatus,
  runtimeRoutingEnabled: BLULADDER_KLAMATH.site.runtimeRoutingEnabled,
};
