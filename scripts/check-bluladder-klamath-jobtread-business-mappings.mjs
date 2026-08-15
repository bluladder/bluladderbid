import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  evidence:
    "docs/operations/bluladder-klamath-jobtread-business-mapping-gates.json",
  docs:
    "docs/architecture/bluladder-klamath-jobtread-business-mappings.md",
  mappings: "supabase/functions/_shared/jobtreadBusinessMappings.ts",
  tests: "supabase/functions/_shared/jobtreadBusinessMappings_test.ts",
  adapter: "supabase/functions/_shared/jobtreadConnectorAdapter.ts",
  transport: "supabase/functions/_shared/jobtreadPaveClient.ts",
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
  errors.push(`invalid JobTread business mapping evidence: ${error.message}`);
}

const approved = [
  "health",
  "customer_sync",
  "availability_read",
  "booking_create",
  "booking_update",
];
const blocked = [
  "quote_sync",
  "booking_cancel",
  "invoice_handoff",
  "communications_handoff",
];
if (JSON.stringify(evidence?.approved_capabilities) !== JSON.stringify(approved)) {
  errors.push("approved JobTread mapping capabilities drifted");
}
if (JSON.stringify(evidence?.blocked_capabilities) !== JSON.stringify(blocked)) {
  errors.push("blocked JobTread mapping capabilities drifted");
}
for (const flag of [
  "official_api_explorer_verified",
  "server_owned_provider_authority_required",
  "custom_field_bindings_required",
  "stable_internal_references_required",
  "write_idempotency_required",
  "outcome_uncertain_reconciliation_required",
  "schedule_read_is_busy_evidence_only",
  "grant_created",
  "custom_fields_created",
  "protected_custom_field_bindings_resolved",
  "provider_preflight_read_verified",
  "provider_preflight_read_used_grant",
  "runtime_entrypoint_adopted",
  "credential_configured",
  "credential_verified",
  "protected_custom_field_bindings_recorded",
  "connector_row_created",
  "provider_calls_performed",
  "provider_resources_mutated",
  "hosted_mutation_performed",
  "deployment_performed",
]) {
  if (evidence?.[flag] !== true) errors.push(`${flag} must be true`);
}
for (const flag of [
  "mutation_auto_retry_allowed",
  "booking_job_schedule_published",
  "provider_notifications_enabled",
  "webhook_created",
  "runtime_provider_calls_performed",
  "activation_allowed",
  "customer_traffic_allowed",
  "dfw_fallback_allowed",
]) {
  if (evidence?.[flag] !== false) errors.push(`${flag} must remain false`);
}
if (
  evidence?.status !==
    "protected_configuration_and_inactive_connector_verified" ||
  evidence?.connector_exact_inactive_count !== 1 ||
  evidence?.connector_activation_surface_count !== 0 ||
  evidence?.connector_webhook_reference_count !== 0 ||
  evidence?.runtime_flag_present !== false
) errors.push("inactive hosted connector receipt drifted");

for (const operation of [
  "currentGrant",
  "organization.accounts",
  "createAccount",
  "updateAccount",
  "createContact",
  "updateContact",
  "createLocation",
  "updateLocation",
  "organization.tasks",
  "createJob",
  "createTask",
  "updateTask",
]) {
  if (!evidence?.verified_operation_roots?.includes(operation)) {
    errors.push(`verified provider operation omitted: ${operation}`);
  }
}

for (const phrase of [
  "JOBTREAD_APPROVED_MAPPING_CAPABILITIES",
  "JOBTREAD_BLOCKED_MAPPING_CAPABILITIES",
  "hasOnlyKeys",
  "organization_lineage_mismatch",
  "provider_state_ambiguous",
  "scheduleIsPublished: false",
  "notify: false",
  "updateDependentTasks: false",
  "updateRecurringTasks: false",
  "mapping_unsupported",
]) {
  if (!contents.mappings?.includes(phrase)) {
    errors.push(`mapping source omits: ${phrase}`);
  }
}
if (/grantKey\s*:/.test(contents.mappings ?? "")) {
  errors.push("mapping planner may not accept or inject Grant Key material");
}
for (const forbiddenRoot of [
  "deleteTask:",
  "createDocument:",
  "createDailyLog:",
  "createFile:",
]) {
  if (contents.mappings?.includes(forbiddenRoot)) {
    errors.push(`blocked provider mutation appears in mapping: ${forbiddenRoot}`);
  }
}
for (const phrase of [
  "rejects cross-organization",
  "fails closed when a custom-field binding is missing",
  "plans the exact account contact and location sequence",
  "bounded to job tasks",
  "one job then one non-notifying scheduled task",
  "without a query",
  "never contain transport credentials",
]) {
  if (!contents.tests?.includes(phrase)) {
    errors.push(`mapping tests omit: ${phrase}`);
  }
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("JobTread business mapping tests may not be skipped");
}
for (const phrase of [
  "There is no Jobber or DFW fallback",
  "quote_sync",
  "booking_cancel",
  "outcome-uncertain",
  "mapping is not runtime-reachable",
  "Grant-authenticated Pave preflight",
  "runtime-disabled",
]) {
  if (!contents.docs?.includes(phrase)) {
    errors.push(`mapping documentation omits: ${phrase}`);
  }
}
if (!contents.adapter?.includes("supportedCapabilities")) {
  errors.push("JobTread adapter lost explicit capability gating");
}
if (
  !contents.transport?.includes("request.mutation === true") ||
  !contents.transport?.includes("outcomeUncertain")
) errors.push("JobTread transport lost uncertain-write protection");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread business mappings OK: protected configuration and one inactive connector are verified; provider writes, runtime, and traffic remain disabled.",
);
