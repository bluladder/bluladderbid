import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath =
  "docs/operations/bluladder-klamath-vapi-readiness.json";
const manifestPath =
  "docs/operations/bluladder-klamath-vapi-manifest.template.json";
const provisioningPath =
  "docs/operations/bluladder-klamath-vapi-provisioning-receipt.template.json";
const handoffPath = "docs/voice/bluladder-klamath-handoff.md";
const receiptText = fs.readFileSync(path.join(root, receiptPath), "utf8");
const manifestText = fs.readFileSync(path.join(root, manifestPath), "utf8");
const provisioningText = fs.readFileSync(path.join(root, provisioningPath), "utf8");
const handoff = fs.readFileSync(path.join(root, handoffPath), "utf8");
const handoffNormalized = handoff.replace(/\s+/g, " ");
const errors = [];

let receipt;
let manifest;
let provisioning;
try {
  receipt = JSON.parse(receiptText);
  manifest = JSON.parse(manifestText);
  provisioning = JSON.parse(provisioningText);
} catch (error) {
  errors.push(`Vapi readiness receipt is invalid JSON: ${error.message}`);
}

const expectedKeys = [
  "schema_version",
  "tenant_key",
  "provider_inventory_observed_at",
  "repository_approval_recorded_at",
  "evidence_class",
  "provider_boundary_uniquely_matched",
  "assistant_inventory_count",
  "phone_resource_inventory_count",
  "isolated_klamath_assistant_present",
  "isolated_klamath_phone_resource_present",
  "non_klamath_resources_preserved",
  "existing_resource_reuse_authorized",
  "candidate_configuration_approved",
  "candidate_approved_source_sha256",
  "candidate_approval_record_ref",
  "provisioning_authorized",
  "provider_mutation_performed",
  "call_or_message_performed",
  "credential_or_secret_inspected",
  "contains_provider_identifiers",
  "contains_phone_digits",
  "contains_credentials",
  "next_gate",
];

if (JSON.stringify(Object.keys(receipt ?? {})) !== JSON.stringify(expectedKeys)) {
  errors.push("Vapi readiness receipt field set or order drifted");
}
if (
  receipt?.schema_version !== 1 ||
  receipt?.tenant_key !== "bluladder-klamath" ||
  receipt?.evidence_class !==
    "sanitized_vapi_post_provisioning_plus_repository_owner_approval" ||
  receipt?.provider_inventory_observed_at !== "2026-08-22" ||
  receipt?.repository_approval_recorded_at !== "2026-08-22T03:56:43Z" ||
  receipt?.provider_boundary_uniquely_matched !== true
) {
  errors.push("Vapi readiness receipt identity drifted");
}
if (
  receipt?.assistant_inventory_count !== 6 ||
  receipt?.phone_resource_inventory_count !== 2 ||
  receipt?.isolated_klamath_assistant_present !== true ||
  receipt?.isolated_klamath_phone_resource_present !== true ||
  receipt?.non_klamath_resources_preserved !== true
) {
  errors.push("signed-in Vapi inventory evidence drifted");
}
if (
  receipt?.candidate_configuration_approved !== true ||
  receipt?.candidate_approved_source_sha256 !==
    "f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1" ||
  receipt?.candidate_approval_record_ref !==
    "primary-release-chat:sha256:d64402b364d8222c2bbc0144779fed0d3cf5a4b2e2a86f56cfabfd2fe799e024"
) {
  errors.push("Vapi owner-approval evidence drifted");
}
for (const field of [
  "existing_resource_reuse_authorized",
  "call_or_message_performed",
  "credential_or_secret_inspected",
  "contains_provider_identifiers",
  "contains_phone_digits",
  "contains_credentials",
]) {
  if (receipt?.[field] !== false) errors.push(`fail-closed field drifted: ${field}`);
}
if (
  receipt?.provisioning_authorized !== true ||
  receipt?.provider_mutation_performed !== true ||
  receipt?.next_gate !== "hosted_tenant_binding_review"
) {
  errors.push("Vapi next-gate boundary drifted");
}

if (
  manifest?.ownerApproval?.status !== "approved" ||
  manifest?.ownerApproval?.recordRef !== receipt?.candidate_approval_record_ref ||
  manifest?.ownerApproval?.approvedAt !==
    receipt?.repository_approval_recorded_at ||
  manifest?.ownerApproval?.approvedSourceSha256 !==
    receipt?.candidate_approved_source_sha256 ||
  manifest?.contractTestsPassed !== true ||
  manifest?.provisioningAllowed !== false ||
  manifest?.callAllowed !== false ||
  manifest?.activationAllowed !== false
) {
  errors.push("Vapi manifest approval is not bound to the readiness evidence");
}

const sha256Pattern = /^[0-9a-f]{64}$/;
if (
  provisioning?.status !== "verified" ||
  typeof provisioning?.observedAt !== "string" ||
  Number.isNaN(new Date(provisioning.observedAt).valueOf()) ||
  provisioning?.manifestSourceSha256 !==
    receipt?.candidate_approved_source_sha256 ||
  provisioning?.assistant?.uniqueMatchCount !== 1 ||
  provisioning?.assistant?.creationSucceeded !== true ||
  provisioning?.assistant?.savedStateVerified !== true ||
  provisioning?.assistant?.configurationMatched !== true ||
  !sha256Pattern.test(provisioning?.assistant?.identityFingerprintSha256 ?? "") ||
  !/^v\d+$/.test(provisioning?.assistant?.providerVersionMarker ?? "") ||
  JSON.stringify(provisioning?.assistant?.driftPaths) !== "[]" ||
  provisioning?.phone?.uniqueMatchCount !== 1 ||
  provisioning?.phone?.importSucceeded !== true ||
  provisioning?.phone?.voiceOnly !== true ||
  provisioning?.phone?.smsDisabled !== true ||
  provisioning?.phone?.assistantBindingAbsent !== true ||
  !sha256Pattern.test(provisioning?.phone?.identityFingerprintSha256 ?? "") ||
  provisioning?.safeguards?.nonKlamathResourcesPreserved !== true ||
  provisioning?.safeguards?.twilioMessagingConfigurationUnchanged !== true ||
  provisioning?.safeguards?.temporaryVapiKeyRevoked !== true ||
  provisioning?.hostedMappingsVerified !== false ||
  provisioning?.deploymentVerified !== false ||
  provisioning?.ownerQaPassed !== false ||
  provisioning?.activationAllowed !== false ||
  provisioning?.customerTrafficAllowed !== false ||
  provisioning?.nextGate !== "hosted_tenant_binding_review"
) {
  errors.push("Vapi verified post-provisioning receipt drifted");
}

if (
  Object.values(provisioning?.customerActionCounts ?? {}).some(
    (value) => value !== 0,
  ) ||
  Object.entries(provisioning?.safeguards ?? {}).some(([key, value]) =>
    key.startsWith("contains") && value !== false
  ) ||
  JSON.stringify(provisioning?.blockerCodes) !== "[]"
) {
  errors.push("Vapi verified receipt opened a disclosure or customer-action gate");
}

const prohibitedValuePatterns = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\+[1-9][0-9]{7,14}\b/,
  /https?:\/\//i,
  /\b(?:AC|PN|CM|BN)[0-9a-f]{12,}\b/i,
];
for (const pattern of prohibitedValuePatterns) {
  if (pattern.test(`${receiptText}\n${provisioningText}`)) {
    errors.push(`Vapi readiness receipt contains prohibited value shape: ${pattern}`);
  }
}

for (const fragment of [
  "sanitized Vapi provisioning evidence",
  "Existing DFW and other non-Klamath resources are preserved",
  "does not authorize customer traffic",
  "manifest candidate is owner-approved",
  "hosted tenant-binding review",
  "No call is allowed",
]) {
  if (!handoffNormalized.includes(fragment)) {
    errors.push(`${handoffPath} omits: ${fragment}`);
  }
}

if (errors.length) {
  console.error("Klamath Vapi readiness contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath Vapi readiness OK: sanitized assistant and voice-only phone evidence are verified; hosted mapping, deployment, calls, messages, customer traffic, and activation remain blocked.",
);
