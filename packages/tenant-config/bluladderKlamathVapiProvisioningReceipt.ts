export const KLAMATH_VAPI_CANDIDATE_MANIFEST_SHA256 =
  "cb53e67ccba87d01a6251f71b80c081f3ab296e4a3f6ea767112c14739bcdb90";
export const KLAMATH_VAPI_CANDIDATE_OWNER_APPROVED = false;

export interface KlamathVapiProvisioningReceipt {
  schemaVersion: 1;
  tenantKey: "bluladder-klamath";
  evidenceClass: "sanitized_vapi_post_provisioning";
  status: "pending" | "verified" | "blocked";
  observedAt: string | null;
  manifestSourceSha256: string;
  assistant: {
    uniqueMatchCount: number | null;
    creationSucceeded: boolean | null;
    savedStateVerified: boolean | null;
    configurationMatched: boolean | null;
    identityFingerprintSha256: string | null;
    providerVersionMarker: string | null;
    driftPaths: string[];
  };
  phone: {
    uniqueMatchCount: number | null;
    importSucceeded: boolean | null;
    voiceOnly: boolean | null;
    smsDisabled: boolean | null;
    assistantBindingAbsent: boolean | null;
    identityFingerprintSha256: string | null;
  };
  safeguards: {
    nonKlamathResourcesPreserved: boolean | null;
    twilioMessagingConfigurationUnchanged: boolean | null;
    temporaryVapiKeyRevoked: boolean | null;
    containsProviderIdentifiers: false;
    containsPhoneDigits: false;
    containsCredentials: false;
    containsHeaders: false;
    containsServerUrls: false;
    containsRecipientDetails: false;
    containsCustomerData: false;
    containsMessageContents: false;
  };
  customerActionCounts: {
    calls: number;
    messages: number;
    toolInvocations: number;
    transfers: number;
  };
  hostedMappingsVerified: false;
  deploymentVerified: false;
  ownerQaPassed: false;
  activationAllowed: false;
  customerTrafficAllowed: false;
  blockerCodes: string[];
  nextGate:
    | "awaiting_manifest_owner_approval"
    | "awaiting_sanitized_provider_evidence"
    | "hosted_tenant_binding_review"
    | "provider_repair_review";
}

export const KLAMATH_VAPI_PROVISIONING_RECEIPT_TEMPLATE:
  KlamathVapiProvisioningReceipt = {
    schemaVersion: 1,
    tenantKey: "bluladder-klamath",
    evidenceClass: "sanitized_vapi_post_provisioning",
    status: "pending",
    observedAt: null,
    manifestSourceSha256: KLAMATH_VAPI_CANDIDATE_MANIFEST_SHA256,
    assistant: {
      uniqueMatchCount: null,
      creationSucceeded: null,
      savedStateVerified: null,
      configurationMatched: null,
      identityFingerprintSha256: null,
      providerVersionMarker: null,
      driftPaths: [],
    },
    phone: {
      uniqueMatchCount: null,
      importSucceeded: null,
      voiceOnly: null,
      smsDisabled: null,
      assistantBindingAbsent: null,
      identityFingerprintSha256: null,
    },
    safeguards: {
      nonKlamathResourcesPreserved: null,
      twilioMessagingConfigurationUnchanged: null,
      temporaryVapiKeyRevoked: null,
      containsProviderIdentifiers: false,
      containsPhoneDigits: false,
      containsCredentials: false,
      containsHeaders: false,
      containsServerUrls: false,
      containsRecipientDetails: false,
      containsCustomerData: false,
      containsMessageContents: false,
    },
    customerActionCounts: {
      calls: 0,
      messages: 0,
      toolInvocations: 0,
      transfers: 0,
    },
    hostedMappingsVerified: false,
    deploymentVerified: false,
    ownerQaPassed: false,
    activationAllowed: false,
    customerTrafficAllowed: false,
    blockerCodes: [],
    nextGate: "awaiting_manifest_owner_approval",
  };

export interface KlamathVapiProvisioningReceiptResult {
  status: "blocked" | "eligible_for_hosted_binding_review";
  activationAllowed: false;
  blockers: readonly string[];
}

const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "tenantKey",
  "evidenceClass",
  "status",
  "observedAt",
  "manifestSourceSha256",
  "assistant",
  "phone",
  "safeguards",
  "customerActionCounts",
  "hostedMappingsVerified",
  "deploymentVerified",
  "ownerQaPassed",
  "activationAllowed",
  "customerTrafficAllowed",
  "blockerCodes",
  "nextGate",
]);
const ASSISTANT_KEYS = new Set([
  "uniqueMatchCount",
  "creationSucceeded",
  "savedStateVerified",
  "configurationMatched",
  "identityFingerprintSha256",
  "providerVersionMarker",
  "driftPaths",
]);
const PHONE_KEYS = new Set([
  "uniqueMatchCount",
  "importSucceeded",
  "voiceOnly",
  "smsDisabled",
  "assistantBindingAbsent",
  "identityFingerprintSha256",
]);
const SAFEGUARD_KEYS = new Set([
  "nonKlamathResourcesPreserved",
  "twilioMessagingConfigurationUnchanged",
  "temporaryVapiKeyRevoked",
  "containsProviderIdentifiers",
  "containsPhoneDigits",
  "containsCredentials",
  "containsHeaders",
  "containsServerUrls",
  "containsRecipientDetails",
  "containsCustomerData",
  "containsMessageContents",
]);
const ACTION_KEYS = new Set([
  "calls",
  "messages",
  "toolInvocations",
  "transfers",
]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const BLOCKER_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DRIFT_PATH_PATTERN = /^\$(?:\.[A-Za-z][A-Za-z0-9_]*|\[\*\])*$/;
const PROHIBITED_KEY_PATTERN =
  /(?:assistantId|phoneId|phoneNumber|toolId|credentialId|providerId|accountSid|authToken|authorization|headers?|serverUrl|transferRecipient|customerData|messageContent|emailAddress)/i;
const PROHIBITED_VALUE_PATTERNS = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\+[1-9][0-9]{7,14}\b/,
  /https?:\/\//i,
  /\b(?:AC|PN|CM|BN|MG)[0-9a-f]{12,}\b/i,
  /bearer\s+[A-Za-z0-9._-]{8,}/i,
  /(?:sk|pk)-[A-Za-z0-9_-]{16,}/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validUtcTimestamp(value: unknown): value is string {
  return typeof value === "string" && UTC_PATTERN.test(value) &&
    !Number.isNaN(new Date(value).valueOf());
}

function inspectAllowedFields(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string,
  blockers: string[],
): void {
  if (!isRecord(value)) {
    blockers.push(`invalid_object:${path}`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) blockers.push(`unexpected_field:${path}.${key}`);
  }
}

function inspectProhibitedEvidence(
  value: unknown,
  path: string,
  blockers: string[],
): void {
  if (typeof value === "string") {
    for (const pattern of PROHIBITED_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        blockers.push(`prohibited_value:${path}`);
        break;
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      inspectProhibitedEvidence(child, `${path}[${index}]`, blockers)
    );
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (!key.startsWith("contains") && PROHIBITED_KEY_PATTERN.test(key)) {
      blockers.push(`prohibited_field:${path}.${key}`);
    }
    inspectProhibitedEvidence(child, `${path}.${key}`, blockers);
  }
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

/**
 * Evaluates sanitized provider evidence only. While candidate approval is
 * pending, even otherwise verified evidence remains blocked. A later,
 * digest-bound approval may open only the separately authorized hosted
 * tenant-binding review.
 */
export function evaluateKlamathVapiProvisioningReceipt(
  input: unknown,
): KlamathVapiProvisioningReceiptResult {
  const blockers: string[] = [];
  inspectProhibitedEvidence(input, "$", blockers);
  inspectAllowedFields(input, TOP_LEVEL_KEYS, "$", blockers);
  if (!isRecord(input)) {
    return { status: "blocked", activationAllowed: false, blockers };
  }

  if (
    input.schemaVersion !== 1 ||
    input.tenantKey !== "bluladder-klamath" ||
    input.evidenceClass !== "sanitized_vapi_post_provisioning" ||
    input.manifestSourceSha256 !== KLAMATH_VAPI_CANDIDATE_MANIFEST_SHA256
  ) {
    blockers.push("receipt_identity_invalid");
  }
  if (!KLAMATH_VAPI_CANDIDATE_OWNER_APPROVED) {
    blockers.push("manifest_owner_approval_pending");
  }

  if (
    input.hostedMappingsVerified !== false ||
    input.deploymentVerified !== false ||
    input.ownerQaPassed !== false ||
    input.activationAllowed !== false ||
    input.customerTrafficAllowed !== false
  ) {
    blockers.push("repository_activation_boundary_open");
  }

  inspectAllowedFields(input.assistant, ASSISTANT_KEYS, "$.assistant", blockers);
  inspectAllowedFields(input.phone, PHONE_KEYS, "$.phone", blockers);
  inspectAllowedFields(input.safeguards, SAFEGUARD_KEYS, "$.safeguards", blockers);
  inspectAllowedFields(
    input.customerActionCounts,
    ACTION_KEYS,
    "$.customerActionCounts",
    blockers,
  );
  const assistantDriftPaths = isRecord(input.assistant)
    ? input.assistant.driftPaths
    : null;
  if (
    !Array.isArray(assistantDriftPaths) ||
    assistantDriftPaths.some((value) =>
      typeof value !== "string" || !DRIFT_PATH_PATTERN.test(value)
    )
  ) {
    blockers.push("unsafe_drift_path");
  }
  if (
    !Array.isArray(input.blockerCodes) ||
    input.blockerCodes.some((value) =>
      typeof value !== "string" || !BLOCKER_CODE_PATTERN.test(value)
    )
  ) {
    blockers.push("unsafe_blocker_code");
  }

  if (input.status === "pending") {
    if (!sameJson(input, KLAMATH_VAPI_PROVISIONING_RECEIPT_TEMPLATE)) {
      blockers.push("pending_receipt_drifted");
    }
    blockers.push("provisioning_evidence_pending");
  } else if (input.status === "verified") {
    const assistant = input.assistant;
    const phone = input.phone;
    const safeguards = input.safeguards;
    const actions = input.customerActionCounts;
    if (
      !validUtcTimestamp(input.observedAt) ||
      !isRecord(assistant) ||
      assistant.uniqueMatchCount !== 1 ||
      assistant.creationSucceeded !== true ||
      assistant.savedStateVerified !== true ||
      assistant.configurationMatched !== true ||
      typeof assistant.identityFingerprintSha256 !== "string" ||
      !SHA256_PATTERN.test(assistant.identityFingerprintSha256) ||
      (assistant.providerVersionMarker !== null &&
        (typeof assistant.providerVersionMarker !== "string" ||
          !/^v\d+$/.test(assistant.providerVersionMarker))) ||
      !Array.isArray(assistant.driftPaths) ||
      assistant.driftPaths.length !== 0
    ) {
      blockers.push("assistant_evidence_invalid");
    }
    if (
      !isRecord(phone) ||
      phone.uniqueMatchCount !== 1 ||
      phone.importSucceeded !== true ||
      phone.voiceOnly !== true ||
      phone.smsDisabled !== true ||
      phone.assistantBindingAbsent !== true ||
      typeof phone.identityFingerprintSha256 !== "string" ||
      !SHA256_PATTERN.test(phone.identityFingerprintSha256)
    ) {
      blockers.push("phone_evidence_invalid");
    }
    if (
      !isRecord(safeguards) ||
      safeguards.nonKlamathResourcesPreserved !== true ||
      safeguards.twilioMessagingConfigurationUnchanged !== true ||
      safeguards.temporaryVapiKeyRevoked !== true ||
      Object.entries(safeguards).some(([key, value]) =>
        key.startsWith("contains") && value !== false
      )
    ) {
      blockers.push("safeguard_evidence_invalid");
    }
    if (
      !isRecord(actions) ||
      Object.values(actions).some((value) =>
        !isNonNegativeInteger(value) || value !== 0
      )
    ) {
      blockers.push("customer_action_detected");
    }
    if (
      !Array.isArray(input.blockerCodes) ||
      input.blockerCodes.length !== 0 ||
      input.nextGate !== "hosted_tenant_binding_review"
    ) {
      blockers.push("verified_receipt_state_invalid");
    }
  } else if (input.status === "blocked") {
    if (
      !Array.isArray(input.blockerCodes) ||
      input.blockerCodes.length === 0 ||
      input.nextGate !== "provider_repair_review"
    ) {
      blockers.push("blocked_receipt_state_invalid");
    }
    blockers.push("provider_provisioning_blocked");
  } else {
    blockers.push("receipt_status_invalid");
  }

  const normalized = [...new Set(blockers)].sort();
  return {
    status: normalized.length
      ? "blocked"
      : "eligible_for_hosted_binding_review",
    activationAllowed: false,
    blockers: normalized,
  };
}
