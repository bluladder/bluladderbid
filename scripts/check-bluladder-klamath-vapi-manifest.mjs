import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  source: "supabase/functions/_shared/voiceProviderKlamathConfig.ts",
  sharedSource: "supabase/functions/_shared/voiceProviderConfig.ts",
  test: "supabase/functions/_shared/voiceProviderKlamathConfig_test.ts",
  template: "docs/operations/bluladder-klamath-vapi-manifest.template.json",
  review: "docs/voice/bluladder-klamath-vapi-manifest.md",
  handoff: "docs/voice/bluladder-klamath-handoff.md",
  readiness: "docs/operations/bluladder-klamath-vapi-readiness.json",
  provisioningTemplate:
    "docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json",
  provisioningContract:
    "docs/voice/bluladder-klamath-vapi-provisioning-receipt.md",
  provisioningImplementation:
    "packages/tenant-config/bluladderKlamathVapiProvisioningReceipt.ts",
  provisioningTests:
    "packages/tenant-config/bluladderKlamathVapiProvisioningReceipt.test.ts",
  serializer:
    "supabase/functions/_shared/voiceProviderKlamathVapiSerializer.ts",
  serializerTests:
    "supabase/functions/_shared/voiceProviderKlamathVapiSerializer_test.ts",
  rawApiRunbook:
    "docs/voice/bluladder-klamath-vapi-raw-api-runbook.md",
};

const expectedSource = {
  bytes: 9195,
  sha256: "f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1",
};
const approvalStatement =
  `APPROVE KLAMATH VAPI MANIFEST ${expectedSource.sha256} AS-IS`;
const approvalStatementSha256 = crypto
  .createHash("sha256")
  .update(approvalStatement)
  .digest("hex");
const expectedApproval = {
  recordRef: `primary-release-chat:sha256:${approvalStatementSha256}`,
  approvedAt: "2026-08-22T03:56:43Z",
};
const supersededSourceSha256 = [
  "dc385cf616c6259b70f9b472d81b90ef048c28f26a55a6fd8bb65dbd4aeecb68",
  "e35e56efca6160be37c1cb35cf213b2aa8f1f66cb82351e6c3c5ee09aa4c47c4",
  "cb53e67ccba87d01a6251f71b80c081f3ab296e4a3f6ea767112c14739bcdb90",
];
const errors = [];
const content = {};

for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

const sourceBuffer = Buffer.from(content.source ?? "", "utf8");
const sourceSha256 = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
if (sourceBuffer.byteLength !== expectedSource.bytes) {
  errors.push(
    `${files.source} byte count drifted: ${sourceBuffer.byteLength} != ${expectedSource.bytes}`,
  );
}
if (sourceSha256 !== expectedSource.sha256) {
  errors.push(`${files.source} SHA-256 drifted: ${sourceSha256}`);
}

let template;
let readiness;
let provisioningTemplate;
try {
  template = JSON.parse(content.template ?? "{}");
  readiness = JSON.parse(content.readiness ?? "{}");
  provisioningTemplate = JSON.parse(content.provisioningTemplate ?? "{}");
} catch (error) {
  errors.push(`Klamath Vapi JSON is invalid: ${error.message}`);
}

const expectedTemplateKeys = [
  "schemaVersion",
  "tenantKey",
  "purpose",
  "source",
  "candidate",
  "ownerApproval",
  "contractTestsPassed",
  "provisioningAllowed",
  "callAllowed",
  "activationAllowed",
];
if (JSON.stringify(Object.keys(template ?? {})) !== JSON.stringify(expectedTemplateKeys)) {
  errors.push("Klamath Vapi manifest template field set or order drifted");
}
if (
  template?.schemaVersion !== 1 ||
  template?.tenantKey !== "bluladder-klamath" ||
  template?.purpose !== "vapi_manifest_owner_review" ||
  template?.source?.path !== files.source ||
  template?.source?.bytes !== expectedSource.bytes ||
  template?.source?.sha256 !== expectedSource.sha256
) {
  errors.push("Klamath Vapi manifest source identity drifted");
}

const candidate = template?.candidate;
const expectedTools = [
  "send_online_quote_link",
  "send_booking_management_link",
  "request_human_transfer",
];
const expectedToolDescriptions = [
  "Text the canonical BluLadder online quote and new-booking link to the trusted current caller ID after explicit caller consent.",
  "Text the canonical secure appointment portal link to the trusted current caller ID after explicit caller consent.",
  "Transfer the current caller to the authoritative local operator only after an explicit human request and only when no customer link was provider-accepted earlier in the call. The server resolves the destination; this tool accepts no destination or caller arguments.",
];
const expectedEvents = [
  "assistant.started",
  "status-update",
  "hang",
  "end-of-call-report",
  "tool-calls",
];
if (
  candidate?.assistantName !== "BluLadder Klamath Realtime" ||
  candidate?.model !== "gpt-realtime-2025-08-28" ||
  candidate?.voice !== "marin" ||
  candidate?.transcriberAbsent !== true ||
  JSON.stringify(candidate?.toolNames) !== JSON.stringify(expectedTools) ||
  candidate?.zeroArgumentTools !== true ||
  candidate?.phoneBindingAbsent !== true ||
  candidate?.transferDestinationAbsent !== true ||
  candidate?.fallbackAssistantAbsent !== true ||
  candidate?.recordingDisabled !== true ||
  candidate?.videoDisabled !== true ||
  candidate?.pcapDisabled !== true ||
  candidate?.loggingDisabled !== true ||
  candidate?.fullMessageHistoryDisabled !== true ||
  candidate?.transcriptRetentionForOwnerQa !== true ||
  candidate?.analysisDisabled !== true ||
  candidate?.maxDurationSeconds !== 900 ||
  JSON.stringify(candidate?.warningHookSeconds) !== JSON.stringify([780, 870]) ||
  JSON.stringify(candidate?.serverEvents) !== JSON.stringify(expectedEvents)
) {
  errors.push("Klamath Vapi candidate summary drifted");
}

if (
  template?.ownerApproval?.status !== "approved" ||
  template?.ownerApproval?.recordRef !== expectedApproval.recordRef ||
  template?.ownerApproval?.approvedAt !== expectedApproval.approvedAt ||
  template?.ownerApproval?.approvedSourceSha256 !== expectedSource.sha256 ||
  template?.contractTestsPassed !== true ||
  template?.provisioningAllowed !== false ||
  template?.callAllowed !== false ||
  template?.activationAllowed !== false
) {
  errors.push("Klamath Vapi owner or activation gate drifted");
}

if (
  readiness?.tenant_key !== "bluladder-klamath" ||
  readiness?.provider_inventory_observed_at !== "2026-08-15" ||
  readiness?.repository_approval_recorded_at !== expectedApproval.approvedAt ||
  readiness?.evidence_class !==
    "signed_in_provider_inventory_plus_repository_owner_approval" ||
  readiness?.isolated_klamath_assistant_present !== false ||
  readiness?.isolated_klamath_phone_resource_present !== false ||
  readiness?.candidate_configuration_approved !== true ||
  readiness?.candidate_approved_source_sha256 !== expectedSource.sha256 ||
  readiness?.candidate_approval_record_ref !== expectedApproval.recordRef ||
  readiness?.provisioning_authorized !== false ||
  readiness?.provider_mutation_performed !== false ||
  readiness?.call_or_message_performed !== false ||
  readiness?.next_gate !==
    "bounded_raw_provider_provisioning_and_saved_state_verification"
) {
  errors.push("signed-in Klamath Vapi readiness receipt no longer fails closed");
}

const expectedProvisioningKeys = [
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
];
const expectedAssistantKeys = [
  "uniqueMatchCount",
  "creationSucceeded",
  "savedStateVerified",
  "configurationMatched",
  "identityFingerprintSha256",
  "providerVersionMarker",
  "driftPaths",
];
const expectedPhoneKeys = [
  "uniqueMatchCount",
  "importSucceeded",
  "voiceOnly",
  "smsDisabled",
  "assistantBindingAbsent",
  "identityFingerprintSha256",
];
const expectedSafeguardKeys = [
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
];
const expectedActionKeys = ["calls", "messages", "toolInvocations", "transfers"];
if (
  JSON.stringify(Object.keys(provisioningTemplate ?? {})) !==
    JSON.stringify(expectedProvisioningKeys) ||
  JSON.stringify(Object.keys(provisioningTemplate?.assistant ?? {})) !==
    JSON.stringify(expectedAssistantKeys) ||
  JSON.stringify(Object.keys(provisioningTemplate?.phone ?? {})) !==
    JSON.stringify(expectedPhoneKeys) ||
  JSON.stringify(Object.keys(provisioningTemplate?.safeguards ?? {})) !==
    JSON.stringify(expectedSafeguardKeys) ||
  JSON.stringify(Object.keys(provisioningTemplate?.customerActionCounts ?? {})) !==
    JSON.stringify(expectedActionKeys)
) {
  errors.push("Klamath Vapi provisioning receipt field set or order drifted");
}
if (
  provisioningTemplate?.schemaVersion !== 1 ||
  provisioningTemplate?.tenantKey !== "bluladder-klamath" ||
  provisioningTemplate?.evidenceClass !==
    "sanitized_vapi_post_provisioning" ||
  provisioningTemplate?.status !== "pending" ||
  provisioningTemplate?.observedAt !== null ||
  provisioningTemplate?.manifestSourceSha256 !== expectedSource.sha256 ||
  provisioningTemplate?.assistant?.uniqueMatchCount !== null ||
  provisioningTemplate?.assistant?.creationSucceeded !== null ||
  provisioningTemplate?.assistant?.savedStateVerified !== null ||
  provisioningTemplate?.assistant?.configurationMatched !== null ||
  provisioningTemplate?.phone?.uniqueMatchCount !== null ||
  provisioningTemplate?.phone?.importSucceeded !== null ||
  provisioningTemplate?.phone?.assistantBindingAbsent !== null ||
  provisioningTemplate?.hostedMappingsVerified !== false ||
  provisioningTemplate?.deploymentVerified !== false ||
  provisioningTemplate?.ownerQaPassed !== false ||
  provisioningTemplate?.activationAllowed !== false ||
  provisioningTemplate?.customerTrafficAllowed !== false ||
  provisioningTemplate?.nextGate !== "awaiting_sanitized_provider_evidence"
) {
  errors.push("Klamath Vapi provisioning receipt must remain pending and closed");
}
if (
  Object.values(provisioningTemplate?.customerActionCounts ?? {}).some(
    (value) => value !== 0,
  ) ||
  Object.entries(provisioningTemplate?.safeguards ?? {}).some(([key, value]) =>
    key.startsWith("contains") && value !== false
  )
) {
  errors.push("Klamath Vapi receipt customer-action or disclosure gate drifted");
}

const source = content.source ?? "";
for (const fragment of [
  'export const KLAMATH_VOICE_ASSISTANT_NAME = "BluLadder Klamath Realtime"',
  'export const KLAMATH_VOICE_MODEL = "gpt-realtime-2025-08-28"',
  'export const KLAMATH_VOICE_VOICE = "marin"',
  "export const KLAMATH_VOICE_MAX_DURATION_SECONDS = 900",
  "export const KLAMATH_VOICE_WARNING_HOOK_SECONDS = [780, 870] as const",
  "Just a heads-up, we have about two minutes left on this call.",
  "We have about thirty seconds left.",
  'model: KLAMATH_VOICE_MODEL',
  'voice: { provider: "openai", voiceId: KLAMATH_VOICE_VOICE }',
  "transcriber: null",
  'backgroundSound: "off"',
  "modelOutputInMessagesEnabled: false",
  "phoneNumber: null",
  "transferDestination: null",
  "recordingEnabled: false",
  "videoRecordingEnabled: false",
  "pcapEnabled: false",
  "loggingEnabled: false",
  "fullMessageHistoryEnabled: false",
  "transcriptPlan: { enabled: true }",
  "summaryPlan: { enabled: false }",
  "structuredDataPlan: { enabled: false }",
  "successEvaluationPlan: { enabled: false }",
  "maxDurationSeconds: KLAMATH_VOICE_MAX_DURATION_SECONDS",
  "events: KLAMATH_VOICE_SERVER_EVENTS",
  "The server resolves all authority from trusted provider context.",
]) {
  if (!source.includes(fragment)) errors.push(`${files.source} omits: ${fragment}`);
}
for (const description of expectedToolDescriptions) {
  const descriptionPattern = new RegExp(
    description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "g",
  );
  if ((source.match(descriptionPattern) ?? []).length !== 1) {
    errors.push(`${files.source} must pin shared tool description exactly once`);
  }
  if (!(content.sharedSource ?? "").includes(description)) {
    errors.push(`${files.source} no longer aligns with ${files.sharedSource}`);
  }
}

const sharedImports = source.match(
  /import[\s\S]*?from "\.\/voiceProviderConfig\.ts";/g,
) ?? [];
if (sharedImports.length !== 1 || !sharedImports[0].startsWith("import type ")) {
  errors.push("Klamath manifest must have exactly one type-only shared import");
}
for (const transitiveName of [
  "VOICE_BETA_MAX_DURATION_SECONDS",
  "VOICE_BETA_TIME_ELAPSED_HOOKS_SECONDS",
  "VOICE_BETA_WARNING_780",
  "VOICE_BETA_WARNING_870",
  "VOICE_REALTIME_MVP_MODEL",
  "VOICE_REALTIME_MVP_VOICE",
  "VOICE_REALTIME_VAPI_ALLOWED_EVENTS",
]) {
  if (source.includes(transitiveName)) {
    errors.push(`Klamath manifest retains runtime dependency: ${transitiveName}`);
  }
}

for (const fragment of [
  'serverMessagesPath: "$.serverMessages"',
  'serverMessagesType: "array"',
  "serverMessages: [...manifest.serverEvents.events]",
  "toolRefs,",
  "verifyKlamathVapiCreateAssistantRequest",
  "verifyKlamathVapiSavedAssistant",
  '"$.monitorPlan"',
]) {
  if (!(content.serializer ?? "").includes(fragment)) {
    errors.push(`${files.serializer} omits compatibility gate: ${fragment}`);
  }
}
if ((content.serializer ?? "").includes("monitorPlan: {")) {
  errors.push("Klamath Vapi serializer emits the historical nested message path");
}
for (const fragment of [
  "uses the live CreateAssistantDTO array path",
  "survives an exact JSON round trip",
  "rejects every known Explorer array failure",
  "rejects the historical nested representation",
  "rejects tool identity or schema drift",
  "Klamath manifest candidate source identity remains exact",
]) {
  if (!(content.serializerTests ?? "").includes(fragment)) {
    errors.push(`${files.serializerTests} omits regression: ${fragment}`);
  }
}
for (const fragment of [
  "CreateAssistantDTO",
  "top-level JSON array",
  "MonitorPlan",
  "at most one raw `POST /assistant` request",
  "verifyKlamathVapiSavedAssistant",
  files.provisioningTemplate,
]) {
  if (!(content.rawApiRunbook ?? "").includes(fragment)) {
    errors.push(`${files.rawApiRunbook} omits handoff gate: ${fragment}`);
  }
}
if ((content.test ?? "").includes('./voiceProviderConfig.ts')) {
  errors.push("Klamath manifest tests must assert literals, not shared constants");
}
for (const fragment of [
  "pins the approved Realtime pipeline literals",
  "pins the tenant-neutral shared tool descriptions",
  "pins duration, privacy, and analysis gates",
  'assertEquals(manifest.model.model, "gpt-realtime-2025-08-28")',
  'voiceId: "marin"',
]) {
  if (!(content.test ?? "").includes(fragment)) {
    errors.push(`${files.test} omits literal regression: ${fragment}`);
  }
}

for (const name of expectedTools) {
  if ((source.match(new RegExp(`"${name}"`, "g")) ?? []).length !== 1) {
    errors.push(`${files.source} must declare ${name} exactly once`);
  }
}
if ((source.match(/zeroArgumentTool\(/g) ?? []).length !== 4) {
  errors.push("Klamath manifest must have one zero-argument helper and three calls");
}

const combinedNonTest = [
  content.source,
  content.template,
  content.review,
  content.handoff,
  content.readiness,
  content.provisioningTemplate,
  content.provisioningContract,
].join("\n");
const prohibitedPatterns = [
  /\+[1-9][0-9]{7,14}\b/,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\b(?:AC|PN|CM|BN|MG)[0-9a-f]{12,}\b/i,
  /bearer\s+[A-Za-z0-9._-]{8,}/i,
  /sk-[A-Za-z0-9]{16,}/i,
  /x-vapi-secret/i,
];
for (const pattern of prohibitedPatterns) {
  if (pattern.test(combinedNonTest)) {
    errors.push(`Klamath Vapi review package contains prohibited value shape: ${pattern}`);
  }
}

const serializerEvidence = [
  content.serializer,
  content.rawApiRunbook,
].join("\n");
for (const pattern of prohibitedPatterns) {
  if (pattern.test(serializerEvidence)) {
    errors.push(
      `Klamath Vapi serializer evidence contains prohibited value shape: ${pattern}`,
    );
  }
}
for (const [key, value] of Object.entries(content)) {
  for (const digest of supersededSourceSha256) {
    if (value?.includes(digest)) {
      errors.push(`${files[key]} retains a superseded Klamath manifest digest`);
    }
  }
}

for (const fragment of [
  approvalStatement,
  expectedApproval.recordRef,
  "exact candidate owner-approved",
  "This package does not create, clone, import, edit, publish, assign, or call",
  "A separate transcriber is absent",
  "Every tool has an empty object schema",
  "Transcript retention remains enabled only for bounded owner QA",
  "Every provider-effective value is pinned in the digest-covered source",
  "The DFW assistant, DFW phone resource, and all other Vapi resources remain out of scope.",
]) {
  if (!(content.review ?? "").replace(/\s+/g, " ").includes(fragment)) {
    errors.push(`${files.review} omits: ${fragment}`);
  }
}

for (const fragment of [
  "exact Klamath Vapi manifest candidate is owner-approved",
  expectedSource.sha256,
  "Owner approval does not prove provider provisioning",
  "provider saved-state evidence, phone binding, hosted tenant mappings, deployment, owner-controlled QA, customer traffic, and final activation are incomplete",
]) {
  if (!(content.handoff ?? "").replace(/\s+/g, " ").includes(fragment)) {
    errors.push(`${files.handoff} omits: ${fragment}`);
  }
}

for (const fragment of [
  "eligible_for_hosted_binding_review",
  "provisioning_evidence_pending",
  "receipt_identity_invalid",
  "prohibited_field",
  "prohibited_value",
  "customer_action_detected",
  "repository_activation_boundary_open",
  "hosted_tenant_binding_review",
  "activationAllowed: false",
]) {
  if (!(content.provisioningImplementation ?? "").includes(fragment)) {
    errors.push(`${files.provisioningImplementation} omits: ${fragment}`);
  }
}
for (const fragment of [
  "keeps the repository template pending and activation closed",
  "can reach only the hosted tenant-binding review",
  "binds evidence to the exact owner-approved manifest digest",
  "rejects raw provider, phone, URL, credential, and message evidence",
  "rejects serializer drift and unsafe phone state",
  "rejects customer actions and any opened launch gate",
  "rejects free-form status metadata",
]) {
  if (!(content.provisioningTests ?? "").includes(fragment)) {
    errors.push(`${files.provisioningTests} omits: ${fragment}`);
  }
}
for (const fragment of [
  "pending sanitized provider evidence",
  expectedSource.sha256,
  "non-reversible SHA-256 identity fingerprints",
  "must never contain a full provider identifier",
  "separately authorized hosted tenant-binding review",
]) {
  if (!(content.provisioningContract ?? "").replace(/\s+/g, " ").includes(fragment)) {
    errors.push(`${files.provisioningContract} omits: ${fragment}`);
  }
}

if (errors.length) {
  console.error("Klamath Vapi manifest contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Klamath Vapi manifest OK: ${expectedSource.bytes} bytes, SHA-256 ${expectedSource.sha256}; owner approval is bound while provider evidence, activation, calls, and messages remain blocked.`,
);
