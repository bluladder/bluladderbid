import {
  BLULADDER_KLAMATH,
  BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
  BLULADDER_KLAMATH_TENANT_KEY,
} from "./bluladderKlamath";

export const KLAMATH_OWNER_DECISION_KEYS = [
  "business_hours",
  "territory_and_services",
  "pricing_and_booking",
  "site_and_branding",
  "messaging_compliance",
  "jobtread_setup",
] as const;

export const KLAMATH_PROTECTED_PRESENCE_KEYS = [
  "local_manager",
  "public_customer_contact",
  "sms_sender_owner",
  "voice_transfer_recipient",
  "sms_alert_recipient",
  "email_alert_recipient",
  "jobtread_admin_owner",
] as const;

export const KLAMATH_PROVIDER_GATE_KEYS = [
  "hosted_foundation_verified",
  "dfw_isolation_verified",
  "site_routing_prepared_and_disabled",
  "klamath_pricing_and_duration_contracts_verified",
  "jobtread_grant_present",
  "jobtread_credential_present",
  "jobtread_custom_fields_verified",
  "jobtread_server_initiated_mode_verified",
  "jobtread_webhook_disabled_verified",
  "jobtread_connector_inactive_verified",
  "twilio_business_profile_approved",
  "sms_consent_surface_verified",
  "sms_help_stop_behavior_verified",
  "privacy_policy_published",
  "terms_published",
  "sms_sample_messages_approved",
  "twilio_campaign_approved",
  "twilio_number_provisioned",
  "twilio_messaging_service_verified",
  "vapi_assistant_verified",
  "vapi_phone_binding_verified",
  "runtime_deployments_verified",
] as const;

export const KLAMATH_RELEASE_GATE_KEYS = [
  "repository_sha_verified",
  "exact_head_ci_passed",
  "secret_scan_passed",
  "hosted_postflights_passed",
  "controlled_qa_passed",
  "rollback_plan_reviewed",
] as const;

export type KlamathOwnerDecisionKey =
  (typeof KLAMATH_OWNER_DECISION_KEYS)[number];
export type KlamathProtectedPresenceKey =
  (typeof KLAMATH_PROTECTED_PRESENCE_KEYS)[number];
export type KlamathProviderGateKey =
  (typeof KLAMATH_PROVIDER_GATE_KEYS)[number];
export type KlamathReleaseGateKey =
  (typeof KLAMATH_RELEASE_GATE_KEYS)[number];

export interface KlamathOwnerApproval {
  status: "pending" | "approved";
  recordRef: string | null;
  approvedAt: string | null;
}

export interface KlamathLaunchDraftSnapshot {
  businessHours: {
    timezone: string;
    localOpen: string;
    localClose: string;
    activeDays: readonly string[];
    holidayPolicy: "manual";
  };
  territoryAndServices: {
    countyKeys: readonly string[];
    communities: readonly string[];
    operatingBases: readonly string[];
    automatedServiceKeys: readonly string[];
    manualReviewServiceKeys: readonly string[];
  };
  pricingAndBooking: {
    profileKey: string;
    profileVersion: number;
    taxPolicy: "oregon_no_general_sales_tax";
    travelPolicyStatus: "manual_review" | "approved";
    includedOneWayTravelMinutes: number;
    waiveTravelChargeAtSubtotal: number;
    proposedFlatTravelCharge: number;
    mileageRate: null;
    promotion99Enabled: false;
    minimumNoticeHours: number;
    cancellationNoticeHours: number;
    quoteExpiryDays: number;
    horizonDays: number;
    paymentTiming: "after_service";
    depositRequired: false;
  };
  siteAndMessaging: {
    canonicalHostname: string;
    publicName: string;
    smsUseCases: readonly string[];
  };
  jobtread: {
    provider: "jobtread";
    approvedCapabilities: readonly string[];
    dfwJobberFallbackAllowed: false;
  };
}

export interface KlamathLaunchInputEnvelope {
  schemaVersion: 1;
  tenantKey: typeof BLULADDER_KLAMATH_TENANT_KEY;
  purpose: "activation_review";
  draftSnapshot: KlamathLaunchDraftSnapshot;
  ownerApprovals: Record<KlamathOwnerDecisionKey, KlamathOwnerApproval>;
  protectedConfigurationPresence: Record<
    KlamathProtectedPresenceKey,
    boolean
  >;
  providerReadiness: Record<KlamathProviderGateKey, boolean>;
  releaseEvidence: Record<KlamathReleaseGateKey, boolean>;
}

export interface KlamathLaunchReadinessResult {
  status: "blocked" | "eligible_for_activation_review";
  activationAllowed: false;
  blockers: readonly string[];
}

export const KLAMATH_OWNER_APPROVAL_RECORD = Object.freeze({
  recordRef: "github-issue-151",
  approvedAt: "2026-08-14T14:33:29Z",
});

export const KLAMATH_EXPECTED_DRAFT_SNAPSHOT: KlamathLaunchDraftSnapshot = {
  businessHours: {
    timezone: BLULADDER_KLAMATH.businessHours.timezone,
    localOpen: BLULADDER_KLAMATH.businessHours.localOpen,
    localClose: BLULADDER_KLAMATH.businessHours.localClose,
    activeDays: BLULADDER_KLAMATH.businessHours.activeDays,
    holidayPolicy: "manual",
  },
  territoryAndServices: {
    countyKeys: BLULADDER_KLAMATH.territory.countyRules.map((rule) => rule.key),
    communities: BLULADDER_KLAMATH.territory.communities,
    operatingBases: BLULADDER_KLAMATH.territory.operatingBases,
    automatedServiceKeys: BLULADDER_KLAMATH.services
      .filter((service) =>
        service.market === "residential" && service.availability === "planned"
      )
      .map((service) => service.serviceKey),
    manualReviewServiceKeys: BLULADDER_KLAMATH.services
      .filter((service) => service.availability === "manual_review")
      .map((service) => service.serviceKey),
  },
  pricingAndBooking: {
    profileKey: BLULADDER_KLAMATH.pricing.profileKey,
    profileVersion: BLULADDER_KLAMATH.pricing.version,
    taxPolicy: BLULADDER_KLAMATH.pricing.taxPolicy,
    travelPolicyStatus: BLULADDER_KLAMATH.pricing.travelPolicyStatus,
    includedOneWayTravelMinutes: 45,
    waiveTravelChargeAtSubtotal: 500,
    proposedFlatTravelCharge: 100,
    mileageRate: null,
    promotion99Enabled: false,
    minimumNoticeHours: BLULADDER_KLAMATH.booking.minimumNoticeHours,
    cancellationNoticeHours: BLULADDER_KLAMATH.booking.cancellationNoticeHours,
    quoteExpiryDays: BLULADDER_KLAMATH.booking.quoteExpiryDays,
    horizonDays: BLULADDER_KLAMATH.booking.horizonDays,
    paymentTiming: BLULADDER_KLAMATH.booking.paymentTiming,
    depositRequired: false,
  },
  siteAndMessaging: {
    canonicalHostname: BLULADDER_KLAMATH_CANONICAL_HOSTNAME,
    publicName: BLULADDER_KLAMATH.branding.publicName,
    smsUseCases: [
      "quote_link",
      "booking_management",
      "reminder",
      "operator_followup",
      "authentication",
    ],
  },
  jobtread: {
    provider: "jobtread",
    approvedCapabilities: [
      "health",
      "customer_sync",
      "availability_read",
      "booking_create",
      "booking_update",
    ],
    dfwJobberFallbackAllowed: false,
  },
};

const recordedApproval = (): KlamathOwnerApproval => ({
  status: "approved",
  ...KLAMATH_OWNER_APPROVAL_RECORD,
});

const falseRecord = <K extends string>(keys: readonly K[]): Record<K, boolean> =>
  Object.fromEntries(keys.map((key) => [key, false])) as Record<K, boolean>;

/**
 * Safe repository template. It records only the non-sensitive owner decisions
 * from issue #151, contains no protected values or provider identifiers, and
 * remains blocked until separately controlled production evidence is captured.
 */
export const BLULADDER_KLAMATH_LAUNCH_INPUT_TEMPLATE:
  KlamathLaunchInputEnvelope = {
    schemaVersion: 1,
    tenantKey: BLULADDER_KLAMATH_TENANT_KEY,
    purpose: "activation_review",
    draftSnapshot: KLAMATH_EXPECTED_DRAFT_SNAPSHOT,
    ownerApprovals: Object.fromEntries(
      KLAMATH_OWNER_DECISION_KEYS.map((key) => [key, recordedApproval()]),
    ) as Record<KlamathOwnerDecisionKey, KlamathOwnerApproval>,
    protectedConfigurationPresence: falseRecord(
      KLAMATH_PROTECTED_PRESENCE_KEYS,
    ),
    providerReadiness: falseRecord(KLAMATH_PROVIDER_GATE_KEYS),
    releaseEvidence: falseRecord(KLAMATH_RELEASE_GATE_KEYS),
  };

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "tenantKey",
  "purpose",
  "draftSnapshot",
  "ownerApprovals",
  "protectedConfigurationPresence",
  "providerReadiness",
  "releaseEvidence",
]);
const DRAFT_KEYS = new Set([
  "businessHours",
  "territoryAndServices",
  "pricingAndBooking",
  "siteAndMessaging",
  "jobtread",
]);
const DRAFT_SECTION_KEYS: Record<keyof KlamathLaunchDraftSnapshot, Set<string>> = {
  businessHours: new Set([
    "timezone",
    "localOpen",
    "localClose",
    "activeDays",
    "holidayPolicy",
  ]),
  territoryAndServices: new Set([
    "countyKeys",
    "communities",
    "operatingBases",
    "automatedServiceKeys",
    "manualReviewServiceKeys",
  ]),
  pricingAndBooking: new Set([
    "profileKey",
    "profileVersion",
    "taxPolicy",
    "travelPolicyStatus",
    "includedOneWayTravelMinutes",
    "waiveTravelChargeAtSubtotal",
    "proposedFlatTravelCharge",
    "mileageRate",
    "promotion99Enabled",
    "minimumNoticeHours",
    "cancellationNoticeHours",
    "quoteExpiryDays",
    "horizonDays",
    "paymentTiming",
    "depositRequired",
  ]),
  siteAndMessaging: new Set([
    "canonicalHostname",
    "publicName",
    "smsUseCases",
  ]),
  jobtread: new Set([
    "provider",
    "approvedCapabilities",
    "dfwJobberFallbackAllowed",
  ]),
};
const APPROVAL_KEYS = new Set(["status", "recordRef", "approvedAt"]);
const SENSITIVE_FIELD_PATTERN =
  /(?:secret|token|password|api.?key|grant.?key|header|provider.?id|account.?id|assistant.?id|phone.?number|email.?address|webhook.?url|tool.?url)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function inspectUnknownKeys(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  blockers: string[],
): void {
  if (!isRecord(value)) {
    blockers.push(`invalid_shape:${path}`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      blockers.push(
        SENSITIVE_FIELD_PATTERN.test(key)
          ? `sensitive_field_present:${path}.${key}`
          : `unexpected_field:${path}.${key}`,
      );
    }
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).valueOf());
}

function inspectBooleanRecord<K extends string>(
  value: unknown,
  keys: readonly K[],
  path: string,
  missingPrefix: string,
  blockers: string[],
): void {
  inspectUnknownKeys(value, new Set(keys), path, blockers);
  if (!isRecord(value)) return;
  for (const key of keys) {
    if (value[key] !== true) blockers.push(`${missingPrefix}:${key}`);
  }
}

/**
 * Evaluates only readiness for a separately approved activation review. This
 * function cannot activate the tenant and always returns activationAllowed:
 * false, including for a fully satisfied evidence envelope.
 */
export function evaluateKlamathLaunchInputs(
  input: unknown,
): KlamathLaunchReadinessResult {
  const blockers: string[] = [];
  inspectUnknownKeys(input, TOP_LEVEL_KEYS, "$", blockers);
  if (!isRecord(input)) {
    return { status: "blocked", activationAllowed: false, blockers };
  }

  if (input.schemaVersion !== 1) blockers.push("schema_version_invalid");
  if (input.tenantKey !== BLULADDER_KLAMATH_TENANT_KEY) {
    blockers.push("tenant_mismatch");
  }
  if (input.purpose !== "activation_review") blockers.push("purpose_invalid");

  inspectUnknownKeys(input.draftSnapshot, DRAFT_KEYS, "$.draftSnapshot", blockers);
  if (isRecord(input.draftSnapshot)) {
    for (const section of Object.keys(DRAFT_SECTION_KEYS) as Array<
      keyof KlamathLaunchDraftSnapshot
    >) {
      inspectUnknownKeys(
        input.draftSnapshot[section],
        DRAFT_SECTION_KEYS[section],
        `$.draftSnapshot.${section}`,
        blockers,
      );
      const actualSection = input.draftSnapshot[section];
      const expectedSection = KLAMATH_EXPECTED_DRAFT_SNAPSHOT[section];
      const sectionMatches = sameJson(actualSection, expectedSection);
      if (!sectionMatches) {
        blockers.push(`draft_snapshot_mismatch:${section}`);
      }
    }
    const activeDays = isRecord(input.draftSnapshot.businessHours)
      ? input.draftSnapshot.businessHours.activeDays
      : null;
    const allowedDays = new Set([
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ]);
    if (
      !Array.isArray(activeDays) || activeDays.length === 0 ||
      new Set(activeDays).size !== activeDays.length ||
      activeDays.some((day) => typeof day !== "string" || !allowedDays.has(day))
    ) {
      blockers.push("business_hours_active_days_invalid");
    }
  } else {
    blockers.push("draft_snapshot_mismatch:all");
  }

  inspectUnknownKeys(
    input.ownerApprovals,
    new Set(KLAMATH_OWNER_DECISION_KEYS),
    "$.ownerApprovals",
    blockers,
  );
  if (isRecord(input.ownerApprovals)) {
    for (const key of KLAMATH_OWNER_DECISION_KEYS) {
      const approval = input.ownerApprovals[key];
      inspectUnknownKeys(
        approval,
        APPROVAL_KEYS,
        `$.ownerApprovals.${key}`,
        blockers,
      );
      if (!isRecord(approval) || approval.status !== "approved") {
        blockers.push(`owner_approval_missing:${key}`);
        continue;
      }
      if (
        typeof approval.recordRef !== "string" ||
        !/^(?:github-issue-\d+|owner-approval-\d{4}-\d{2}-\d{2})$/.test(
          approval.recordRef,
        ) ||
        typeof approval.approvedAt !== "string" ||
        !validUtcTimestamp(approval.approvedAt)
      ) {
        blockers.push(`owner_approval_invalid:${key}`);
      }
    }
  } else {
    for (const key of KLAMATH_OWNER_DECISION_KEYS) {
      blockers.push(`owner_approval_missing:${key}`);
    }
  }

  inspectBooleanRecord(
    input.protectedConfigurationPresence,
    KLAMATH_PROTECTED_PRESENCE_KEYS,
    "$.protectedConfigurationPresence",
    "protected_configuration_missing",
    blockers,
  );
  inspectBooleanRecord(
    input.providerReadiness,
    KLAMATH_PROVIDER_GATE_KEYS,
    "$.providerReadiness",
    "provider_gate_incomplete",
    blockers,
  );
  inspectBooleanRecord(
    input.releaseEvidence,
    KLAMATH_RELEASE_GATE_KEYS,
    "$.releaseEvidence",
    "release_gate_incomplete",
    blockers,
  );

  if (
    BLULADDER_KLAMATH.activationAllowed ||
    BLULADDER_KLAMATH.customerTrafficAllowed ||
    BLULADDER_KLAMATH.site.runtimeRoutingEnabled ||
    BLULADDER_KLAMATH.site.published ||
    BLULADDER_KLAMATH.pricing.runtimeEnabled
  ) {
    blockers.push("repository_activation_boundary_open");
  }
  if (
    BLULADDER_KLAMATH.dfwFallbackAllowed ||
    BLULADDER_KLAMATH.crm.dfwJobberFallbackAllowed
  ) {
    blockers.push("dfw_fallback_boundary_open");
  }

  const normalizedBlockers = [...new Set(blockers)].sort();
  return {
    status: normalizedBlockers.length
      ? "blocked"
      : "eligible_for_activation_review",
    activationAllowed: false,
    blockers: normalizedBlockers,
  };
}
