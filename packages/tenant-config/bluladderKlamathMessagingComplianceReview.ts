import { BLULADDER_KLAMATH } from "./bluladderKlamath";

export const KLAMATH_SMS_USE_CASES = [
  "quote_link",
  "booking_management",
  "reminder",
  "operator_followup",
  "authentication",
] as const;

export const KLAMATH_SMS_SAMPLE_MESSAGES = [
  "BluLadder Klamath: Here is the secure quote link you requested: [secure link]. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  "BluLadder Klamath: Manage your requested booking securely here: [secure link]. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  "BluLadder Klamath reminder: Your scheduled service is on [date] during [arrival window]. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  "BluLadder Klamath: A team member is following up on your request. We will respond through the contact method you selected. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
  "BluLadder Klamath: Your one-time verification code is [code]. It expires in [minutes] minutes. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
] as const;

export const KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE = {
  schemaVersion: 1,
  tenantKey: "bluladder-klamath",
  purpose: "messaging_compliance_owner_legal_review",
  providerRequirementsReviewedAsOf: "2026-08-15",
  campaign: {
    brandName: "BluLadder Klamath",
    description:
      "BluLadder Klamath sends customer-requested secure quote and booking-management links, appointment reminders, one-time authentication codes, and genuine operator follow-up to customers who provide their mobile number and consent in the corresponding web or voice flow. Marketing and promotional messages are outside this launch campaign.",
    useCases: KLAMATH_SMS_USE_CASES,
    recommendedUseCaseCategory: "LOW_VOLUME",
    recommendationStatus:
      "provider_eligibility_verified_owner_and_public_surface_review_pending",
    hasEmbeddedLinks: true,
    hasEmbeddedPhoneNumbers: false,
    keywordOptInSupported: false,
    optInKeywords: [],
    sampleMessages: KLAMATH_SMS_SAMPLE_MESSAGES,
  },
  consent: {
    messageFlow:
      "Website users enter a mobile number and explicitly request a quote link, booking-management link, reminder, operator follow-up, or authentication code. The adjacent disclosure identifies BluLadder Klamath, says message frequency varies and message and data rates may apply, and explains HELP and STOP. Transactional consent is limited to the requested service. Voice callers may request a one-time link during an inbound call; the assistant confirms the request before tool execution. Consent is not a condition of purchase. Privacy Policy: https://klamath.bluladder.com/privacy. Terms and Conditions: https://klamath.bluladder.com/terms.",
    transactionalDisclosure:
      "By requesting a text from BluLadder Klamath, you agree to receive messages related to your quote, booking, appointment, support request, or authentication. Message frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out. Consent is not a condition of purchase. See Privacy Policy and Terms and Conditions.",
    futureMarketingBoundary:
      "Marketing and promotional messages are not part of this launch campaign. Any future marketing campaign requires a separate unchecked marketing opt-in plus separate owner, legal, carrier, and release approval.",
    marketingCheckboxDefaultChecked: false,
    consentRequiredForPurchase: false,
    helpMessage:
      "BluLadder Klamath: Help is available at https://klamath.bluladder.com/contact. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out.",
    optOutMessage:
      "BluLadder Klamath: You have been opted out and will receive no further messages. Reply START to opt in again.",
  },
  publicSurfaces: {
    optInUrl: "https://klamath.bluladder.com/",
    privacyPolicyUrl: "https://klamath.bluladder.com/privacy",
    termsAndConditionsUrl: "https://klamath.bluladder.com/terms",
    supportUrl: "https://klamath.bluladder.com/contact",
    privacyPolicyRequiredStatements: [
      "We do not share, sell, rent, transfer, or otherwise provide mobile phone numbers, text messaging opt-in data, or messaging consent to third parties, affiliates, or lead generators for marketing or promotional purposes.",
      "Message frequency varies.",
      "Message and data rates may apply.",
      "Reply STOP to opt out and HELP for help.",
    ],
    termsRequiredStatements: [
      "The messaging program is operated by BluLadder Klamath.",
      "Messages may include requested quote and booking links, reminders, operator follow-up, and authentication. Marketing and promotional messages are outside this launch program.",
      "Message frequency varies and message and data rates may apply.",
      "Reply STOP to opt out and HELP for help.",
      "For customer support, reply HELP or visit https://klamath.bluladder.com/contact.",
      "Privacy Policy: https://klamath.bluladder.com/privacy.",
      "Carriers are not liable for delayed or undelivered messages.",
      "Consent is not a condition of purchase.",
    ],
  },
  sourceImplementationChanged: false,
  publicSurfacesPublished: false,
  providerCampaignSubmitted: false,
  messagingRuntimeEnabled: false,
  customerTrafficAllowed: false,
  activationAllowed: false,
} as const;

export interface KlamathMessagingComplianceReviewEnvelope {
  candidate: typeof KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE;
  ownerApproval: {
    status: "pending" | "approved";
    recordRef: string | null;
    approvedAt: string | null;
  };
  legalReview: {
    status: "pending" | "approved";
    recordRef: string | null;
    approvedAt: string | null;
  };
  publicSurfacesVerified: boolean;
  providerUseCaseEligibilityVerified: boolean;
  contractTestsPassed: boolean;
}

export interface KlamathMessagingComplianceReviewResult {
  status: "blocked" | "eligible_for_twilio_campaign_submission_review";
  activationAllowed: false;
  blockers: readonly string[];
}

export const KLAMATH_MESSAGING_COMPLIANCE_REVIEW_TEMPLATE:
  KlamathMessagingComplianceReviewEnvelope = {
    candidate: KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE,
    ownerApproval: {
      status: "pending",
      recordRef: null,
      approvedAt: null,
    },
    legalReview: {
      status: "pending",
      recordRef: null,
      approvedAt: null,
    },
    publicSurfacesVerified: false,
    providerUseCaseEligibilityVerified: true,
    contractTestsPassed: false,
  };

const TOP_LEVEL_KEYS = new Set([
  "candidate",
  "ownerApproval",
  "legalReview",
  "publicSurfacesVerified",
  "providerUseCaseEligibilityVerified",
  "contractTestsPassed",
]);
const REVIEW_KEYS = new Set(["status", "recordRef", "approvedAt"]);
const SENSITIVE_FIELD_PATTERN =
  /(?:secret|token|password|api.?key|grant.?key|header|provider.?id|account.?id|phone.?number|email.?address|webhook.?url|tool.?url)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key])]),
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeJson(left)) ===
    JSON.stringify(canonicalizeJson(right));
}

function validUtcTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    return false;
  }
  return !Number.isNaN(new Date(value).valueOf());
}

function inspectFields(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  blockers: string[],
): void {
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      blockers.push(`sensitive_field_present:${path}.${key}`);
    } else if (!allowed.has(key)) {
      blockers.push(`unexpected_field:${path}.${key}`);
    }
  }
}

function inspectReview(
  value: unknown,
  label: "owner" | "legal",
  blockers: string[],
): void {
  inspectFields(
    value,
    REVIEW_KEYS,
    label === "owner" ? "$.ownerApproval" : "$.legalReview",
    blockers,
  );
  if (!isRecord(value) || value.status !== "approved") {
    blockers.push(`${label}_review_missing`);
    return;
  }
  const validRecordRef = label === "owner"
    ? /^(?:github-issue-\d+|owner-approval-\d{4}-\d{2}-\d{2})$/
    : /^legal-review-\d{4}-\d{2}-\d{2}$/;
  if (
    typeof value.recordRef !== "string" ||
    !validRecordRef.test(value.recordRef) ||
    typeof value.approvedAt !== "string" ||
    !validUtcTimestamp(value.approvedAt)
  ) blockers.push(`${label}_review_invalid`);
}

/**
 * Evaluates only whether the exact candidate may proceed to a separately
 * controlled Twilio campaign-submission review. It cannot submit a campaign,
 * publish public surfaces, enable messaging, or activate Klamath.
 */
export function evaluateKlamathMessagingComplianceReview(
  input: unknown,
): KlamathMessagingComplianceReviewResult {
  const blockers: string[] = [];
  inspectFields(input, TOP_LEVEL_KEYS, "$", blockers);
  if (!isRecord(input)) {
    return { status: "blocked", activationAllowed: false, blockers };
  }

  if (!sameJson(input.candidate, KLAMATH_MESSAGING_COMPLIANCE_REVIEW_CANDIDATE)) {
    blockers.push("candidate_snapshot_mismatch");
  }
  inspectReview(input.ownerApproval, "owner", blockers);
  inspectReview(input.legalReview, "legal", blockers);
  if (input.publicSurfacesVerified !== true) {
    blockers.push("public_surfaces_not_verified");
  }
  if (input.providerUseCaseEligibilityVerified !== true) {
    blockers.push("provider_use_case_eligibility_not_verified");
  }
  if (input.contractTestsPassed !== true) {
    blockers.push("contract_tests_not_verified");
  }

  if (
    BLULADDER_KLAMATH.lifecycle !== "provisioning" ||
    BLULADDER_KLAMATH.site.published ||
    BLULADDER_KLAMATH.site.runtimeRoutingEnabled ||
    BLULADDER_KLAMATH.customerTrafficAllowed ||
    BLULADDER_KLAMATH.activationAllowed
  ) blockers.push("repository_runtime_boundary_open");

  const normalized = [...new Set(blockers)].sort();
  return {
    status: normalized.length
      ? "blocked"
      : "eligible_for_twilio_campaign_submission_review",
    activationAllowed: false,
    blockers: normalized,
  };
}
