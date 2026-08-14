import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  source:
    "supabase/functions/_shared/jobtreadExecutionComposition.ts",
  tests:
    "supabase/functions/_shared/jobtreadExecutionComposition_test.ts",
  contract:
    "docs/architecture/bluladder-klamath-jobtread-execution-composition.md",
  register:
    "docs/operations/bluladder-klamath-jobtread-execution-composition-gates.json",
  runner: "supabase/functions/_shared/jobtreadExecutionRunner.ts",
};
const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}
let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`invalid gate register: ${error.message}`);
}
const exact = {
  read_source_constructed_internally: true,
  write_source_constructed_internally: true,
  blocked_capability_source_resolution_allowed: false,
  dependency_error_detail_returned: false,
  production_imported: false,
  runtime_entrypoint_adopted: false,
  credential_created: false,
  credential_value_stored_in_repository: false,
  connector_created: false,
  custom_fields_created: true,
  protected_custom_field_bindings_recorded: false,
  provider_resources_mutated: true,
  provider_transport_executed: false,
  operation_attempt_created: false,
  mutation_auto_retry_allowed: false,
  deployment_performed: false,
  hosted_mutation_performed: false,
  provider_calls_performed: false,
  activation_allowed: false,
  customer_traffic_allowed: false,
  dfw_fallback_allowed: false,
};
for (const [key, value] of Object.entries(exact)) {
  if (register?.[key] !== value) errors.push(`register ${key} drifted`);
}
if (
  JSON.stringify(register?.approved_read_capabilities) !==
    JSON.stringify(["health", "availability_read"])
) errors.push("approved read capability set drifted");
if (
  JSON.stringify(register?.approved_write_capabilities) !==
    JSON.stringify(["customer_sync", "booking_create", "booking_update"])
) errors.push("approved write capability set drifted");
if (
  JSON.stringify(register?.blocked_capabilities) !== JSON.stringify([
    "quote_sync",
    "booking_cancel",
    "invoice_handoff",
    "communications_handoff",
  ])
) errors.push("blocked capability set drifted");
for (const phrase of [
  "createJobTreadReadPlanSource",
  "createJobTreadWritePlanSource",
  "createJobTreadExecutionRunner",
  "READ_CAPABILITIES.has",
  "WRITE_CAPABILITIES.has",
  "catch {",
  "return null",
]) {
  if (!content.source?.includes(phrase)) errors.push(`source omits ${phrase}`);
}
for (const phrase of [
  "exact five approved capabilities route to one reviewed source",
  "blocked capabilities stop before both protected plan sources",
  "selected source failures are redacted without cross-routing",
  "dormant composition stops unsupported capability before protected dependencies",
  "dormant composition wires one synthetic health read through the runner",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "The composition constructs the reviewed read and write sources internally",
  "Mutation retry remains prohibited",
  "cannot supply provider organization",
  "intentionally unreachable",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
for (const phrase of [
  "providerOrganizationFingerprint",
  "configurationVersion !== connector.configurationVersion",
  "attempts.claim",
  "validatePlanLineage",
  "validateProviderResponse",
]) {
  if (!content.runner?.includes(phrase)) errors.push(`runner omits ${phrase}`);
}
const functionRoot = path.join(root, "supabase/functions");
const productionImports = [];
for (const entry of fs.readdirSync(functionRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "_shared") continue;
  const index = path.join(functionRoot, entry.name, "index.ts");
  if (
    fs.existsSync(index) &&
    fs.readFileSync(index, "utf8").includes("jobtreadExecutionComposition")
  ) productionImports.push(path.relative(root, index));
}
if (productionImports.length) {
  errors.push(`composition unexpectedly imported: ${productionImports.join(", ")}`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread composition OK: exact reviewed sources and runner wired; production, credentials, provider traffic, and activation absent.",
);
