import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath =
  "docs/operations/bluladder-klamath-vapi-readiness.json";
const handoffPath = "docs/voice/bluladder-klamath-handoff.md";
const receiptText = fs.readFileSync(path.join(root, receiptPath), "utf8");
const handoff = fs.readFileSync(path.join(root, handoffPath), "utf8");
const handoffNormalized = handoff.replace(/\s+/g, " ");
const errors = [];

let receipt;
try {
  receipt = JSON.parse(receiptText);
} catch (error) {
  errors.push(`Vapi readiness receipt is invalid JSON: ${error.message}`);
}

const expectedKeys = [
  "schema_version",
  "tenant_key",
  "observed_at",
  "evidence_class",
  "provider_boundary_uniquely_matched",
  "assistant_inventory_count",
  "phone_resource_inventory_count",
  "isolated_klamath_assistant_present",
  "isolated_klamath_phone_resource_present",
  "non_klamath_resources_preserved",
  "existing_resource_reuse_authorized",
  "candidate_configuration_approved",
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
  receipt?.evidence_class !== "signed_in_provider_inventory_read_only" ||
  !/^\d{4}-\d{2}-\d{2}$/.test(receipt?.observed_at ?? "") ||
  receipt?.provider_boundary_uniquely_matched !== true
) {
  errors.push("Vapi readiness receipt identity drifted");
}
if (
  receipt?.assistant_inventory_count !== 5 ||
  receipt?.phone_resource_inventory_count !== 1 ||
  receipt?.isolated_klamath_assistant_present !== false ||
  receipt?.isolated_klamath_phone_resource_present !== false ||
  receipt?.non_klamath_resources_preserved !== true
) {
  errors.push("signed-in Vapi inventory evidence drifted");
}
for (const field of [
  "existing_resource_reuse_authorized",
  "candidate_configuration_approved",
  "provisioning_authorized",
  "provider_mutation_performed",
  "call_or_message_performed",
  "credential_or_secret_inspected",
  "contains_provider_identifiers",
  "contains_phone_digits",
  "contains_credentials",
]) {
  if (receipt?.[field] !== false) errors.push(`fail-closed field drifted: ${field}`);
}
if (
  receipt?.next_gate !==
    "separate_repository_manifest_and_owner_provisioning_review"
) {
  errors.push("Vapi next-gate boundary drifted");
}

const prohibitedValuePatterns = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  /\+[1-9][0-9]{7,14}\b/,
  /https?:\/\//i,
  /\b(?:AC|PN|CM|BN)[0-9a-f]{12,}\b/i,
];
for (const pattern of prohibitedValuePatterns) {
  if (pattern.test(receiptText)) {
    errors.push(`Vapi readiness receipt contains prohibited value shape: ${pattern}`);
  }
}

for (const fragment of [
  "no isolated Klamath assistant or phone resource exists",
  "Existing DFW and other non-Klamath resources are preserved",
  "does not authorize reuse",
  "separately reviewed Klamath assistant manifest",
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
  "Klamath Vapi readiness OK: inventory recorded without identifiers; no Klamath resource, reuse authority, provisioning, or call action exists.",
);
