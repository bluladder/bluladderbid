export type TenantLifecycle =
  | "planning"
  | "provisioning"
  | "active"
  | "suspended"
  | "archived";

export type SiteMappingStatus =
  | "unprovisioned"
  | "provisioning"
  | "active"
  | "disabled";

export interface TenantSitePlan {
  canonicalHostname: string;
  aliases: readonly string[];
  mappingStatus: SiteMappingStatus;
  runtimeRoutingEnabled: boolean;
  published: boolean;
}

export interface TenantTerritoryPlan {
  key: string;
  kind: "county";
  stateCode: string;
  countyName: string;
  effect: "include" | "exclude";
  status: "inactive" | "active";
}

export interface TenantServicePlan {
  serviceKey: string;
  displayName: string;
  market: "residential" | "commercial" | "storefront";
  availability: "planned" | "manual_review" | "available" | "unavailable";
  status: "inactive" | "active";
  reason: string;
}

export interface TenantContactRolePlan {
  role:
    | "local_manager"
    | "public_customer_contact"
    | "voice_transfer_recipient"
    | "sms_alert_recipient"
    | "email_alert_recipient";
  required: boolean;
  configured: boolean;
}

export interface TenantBusinessConfiguration {
  schemaVersion: 1;
  tenantKey: string;
  customerFacingName: string;
  organizationId: string | null;
  lifecycle: TenantLifecycle;
  activationAllowed: boolean;
  customerTrafficAllowed: boolean;
  dfwFallbackAllowed: boolean;
  site: TenantSitePlan;
  branding: {
    publicName: string;
    legalName: string | null;
    tagline: string;
    primaryColor: string;
    accentColor: string;
    headingFont: string;
  };
  locale: {
    timezone: string;
    locale: string;
    currencyCode: string;
  };
  territory: {
    countryCode: "US";
    stateCode: "OR";
    countyRules: readonly TenantTerritoryPlan[];
    communities: readonly string[];
    operatingBases: readonly string[];
  };
  services: readonly TenantServicePlan[];
  businessHours: {
    timezone: string;
    localOpen: string;
    localClose: string;
    activeDays: readonly string[];
    status: "owner_confirmation_required" | "approved";
  };
  booking: {
    minimumNoticeHours: number;
    horizonDays: number;
    cancellationNoticeHours: number;
    quoteExpiryDays: number;
    paymentTiming: "after_service";
    depositRequired: boolean;
    instantConfirmationEnabled: boolean;
  };
  crm: {
    provider: "jobtread";
    connectorStatus: "unverified" | "verified";
    credentialConfigured: boolean;
    dfwJobberFallbackAllowed: false;
  };
  communications: {
    carrier: "twilio";
    primaryNumberCapabilities: readonly ["voice", "sms"];
    numberProvisioned: boolean;
    messagingRegistrationStatus: "not_started" | "pending" | "approved";
    vapiImportStatus: "not_started" | "imported";
    voiceTransferUsesSeparateDestination: boolean;
  };
  contactRoles: readonly TenantContactRolePlan[];
  pricing: {
    profileKey: string;
    version: number;
    status: "draft" | "approved";
    runtimeEnabled: boolean;
    copiedFrom: string;
    taxPolicy: "oregon_no_general_sales_tax";
    travelPolicyStatus: "manual_review" | "approved";
  };
}
