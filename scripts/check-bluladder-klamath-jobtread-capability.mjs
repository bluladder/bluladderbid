import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  evidence:
    "docs/operations/bluladder-klamath-jobtread-capability-gates.json",
  docs: "docs/architecture/organization-connectors-stage-9a.md",
  client: "supabase/functions/_shared/jobtreadPaveClient.ts",
  adapter: "supabase/functions/_shared/jobtreadConnectorAdapter.ts",
  tests: "supabase/functions/_shared/jobtreadConnectorAdapter_test.ts",
};
const errors = [];
const contents = {};
for (const [key, relative] of Object.entries(paths)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[key] = fs.readFileSync(full, "utf8");
}

let evidence;
try {
  evidence = JSON.parse(contents.evidence ?? "{}");
} catch (error) {
  errors.push(`invalid JobTread gate evidence: ${error.message}`);
}

for (const flag of [
  "provider_account_uniquely_matched",
  "organization_scoped_grant_control_available",
  "grant_created",
  "webhook_control_available",
  "official_api_explorer_verified",
  "provider_preflight_read_verified",
  "dormant_transport_prepared",
  "dormant_adapter_prepared",
  "provider_resources_mutated",
]) {
  if (evidence?.[flag] !== true) errors.push(`${flag} must be true`);
}
for (const flag of [
  "credential_configured",
  "credential_verified",
  "webhook_created",
  "runtime_entrypoint_adopted",
  "provider_calls_performed",
  "hosted_mutation_performed",
  "deployment_performed",
  "activation_allowed",
  "customer_traffic_allowed",
  "dfw_fallback_allowed",
  "provider_preflight_read_used_grant",
]) {
  if (evidence?.[flag] !== false) errors.push(`${flag} must remain false`);
}
if (evidence?.provider_preflight_custom_field_count !== 24) {
  errors.push("provider preflight custom-field count must remain 24");
}
const approvedMappings = [
  "health",
  "customer_sync",
  "availability_read",
  "booking_create",
  "booking_update",
];
const blockedMappings = [
  "quote_sync",
  "booking_cancel",
  "invoice_handoff",
  "communications_handoff",
];
if (
  evidence?.business_mapping_contract_prepared !== true ||
  JSON.stringify(evidence?.business_mappings_approved) !==
    JSON.stringify(approvedMappings) ||
  JSON.stringify(evidence?.business_mappings_blocked) !==
    JSON.stringify(blockedMappings)
) {
  errors.push("JobTread business mapping evidence is not the reviewed subset");
}
for (const category of [
  "account",
  "contact",
  "job",
  "task",
  "document",
  "daily_log",
  "file",
]) {
  if (!evidence?.relevant_webhook_categories?.includes(category)) {
    errors.push(`webhook evidence omits ${category}`);
  }
}
for (const phrase of [
  "explicit per-operation allow-list",
  "Grant exists only as an unconfigured provider",
  "performs no automatic",
  "server-owned connector record",
]) {
  if (!contents.docs?.includes(phrase)) {
    errors.push(`JobTread documentation omits: ${phrase}`);
  }
}
for (const phrase of [
  "JOBTREAD_PAVE_ENDPOINT",
  "containsGrantKey",
  "outcomeUncertain",
  "request.mutation === true",
]) {
  if (!contents.client?.includes(phrase)) {
    errors.push(`JobTread transport omits: ${phrase}`);
  }
}
for (const phrase of [
  "guardConnectorRequest",
  "capability_unsupported",
  "supportedCapabilities",
  "jobtread_connector_context_required",
]) {
  if (!contents.adapter?.includes(phrase)) {
    errors.push(`JobTread adapter omits: ${phrase}`);
  }
}
for (const phrase of [
  "blocks cross-organization",
  "requires write idempotency",
  "without provider access",
  "never returns provider error text",
  "outcome-uncertain",
]) {
  if (!contents.tests?.includes(phrase)) {
    errors.push(`JobTread tests omit: ${phrase}`);
  }
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("JobTread tests may not be skipped");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread contract OK: provider primitives and bounded dormant mapping wave verified; credentials/runtime/traffic disabled.",
);
