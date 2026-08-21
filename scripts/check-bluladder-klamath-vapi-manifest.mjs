import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  source: "supabase/functions/_shared/voiceProviderKlamathConfig.ts",
  test: "supabase/functions/_shared/voiceProviderKlamathConfig_test.ts",
  template: "docs/operations/bluladder-klamath-vapi-manifest.template.json",
  review: "docs/voice/bluladder-klamath-vapi-manifest.md",
  handoff: "docs/voice/bluladder-klamath-handoff.md",
  readiness: "docs/operations/bluladder-klamath-vapi-readiness.json",
};

const expectedSource = {
  bytes: 9214,
  sha256: "e35e56efca6160be37c1cb35cf213b2aa8f1f66cb82351e6c3c5ee09aa4c47c4",
};
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
try {
  template = JSON.parse(content.template ?? "{}");
  readiness = JSON.parse(content.readiness ?? "{}");
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
  template?.ownerApproval?.status !== "pending" ||
  template?.ownerApproval?.recordRef !== null ||
  template?.ownerApproval?.approvedAt !== null ||
  template?.ownerApproval?.approvedSourceSha256 !== null ||
  template?.contractTestsPassed !== false ||
  template?.provisioningAllowed !== false ||
  template?.callAllowed !== false ||
  template?.activationAllowed !== false
) {
  errors.push("Klamath Vapi owner or activation gate drifted");
}

if (
  readiness?.tenant_key !== "bluladder-klamath" ||
  readiness?.isolated_klamath_assistant_present !== false ||
  readiness?.isolated_klamath_phone_resource_present !== false ||
  readiness?.candidate_configuration_approved !== false ||
  readiness?.provisioning_authorized !== false ||
  readiness?.provider_mutation_performed !== false ||
  readiness?.call_or_message_performed !== false
) {
  errors.push("signed-in Klamath Vapi readiness receipt no longer fails closed");
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
if ((content.test ?? "").includes('./voiceProviderConfig.ts')) {
  errors.push("Klamath manifest tests must assert literals, not shared constants");
}
for (const fragment of [
  "pins the approved Realtime pipeline literals",
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

const approvalPhrase = `APPROVE KLAMATH VAPI MANIFEST ${expectedSource.sha256}`;
for (const fragment of [
  approvalPhrase,
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
  "exact Klamath Vapi manifest candidate is prepared",
  expectedSource.sha256,
  "does not authorize provisioning",
]) {
  if (!(content.handoff ?? "").replace(/\s+/g, " ").includes(fragment)) {
    errors.push(`${files.handoff} omits: ${fragment}`);
  }
}

if (errors.length) {
  console.error("Klamath Vapi manifest contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Klamath Vapi manifest OK: ${expectedSource.bytes} bytes, SHA-256 ${expectedSource.sha256}; approval, provisioning, activation, calls, and messages remain blocked.`,
);
