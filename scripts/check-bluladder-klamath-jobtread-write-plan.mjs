import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  source: "supabase/functions/_shared/jobtreadWritePlanSource.ts",
  tests: "supabase/functions/_shared/jobtreadWritePlanSource_test.ts",
  contract:
    "docs/architecture/bluladder-klamath-jobtread-write-plan-source.md",
  register:
    "docs/operations/bluladder-klamath-jobtread-write-plan-gates.json",
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
  context_maximum_lifetime_seconds: 300,
  exact_one_server_context_required: true,
  protected_configuration_required: true,
  custom_field_bindings_required: true,
  organization_lineage_required: true,
  configuration_version_match_required: true,
  expected_parent_lineage_required: true,
  already_complete_returns_no_plan: true,
  caller_provider_authority_allowed: false,
  caller_query_allowed: false,
  caller_credential_allowed: false,
  credential_resolved: false,
  operation_attempt_created: false,
  provider_transport_executed: false,
  mutation_auto_retry_allowed: false,
  production_imported: false,
  deployment_performed: false,
  hosted_mutation_performed: false,
  provider_calls_performed: false,
  provider_resources_mutated: false,
  activation_allowed: false,
  customer_traffic_allowed: false,
  dfw_fallback_allowed: false,
};
for (const [key, value] of Object.entries(exact)) {
  if (register?.[key] !== value) errors.push(`register ${key} drifted`);
}
if (
  JSON.stringify(register?.approved_capabilities) !== JSON.stringify([
    "customer_sync",
    "booking_create",
    "booking_update",
  ])
) errors.push("approved write capability set drifted");
for (const phrase of [
  "planJobTreadCustomerSyncStep",
  "planJobTreadBookingCreateStep",
  "planJobTreadBookingUpdate",
  "contexts.length !== 1",
  "shortLivedExpiration",
  "customerLineage",
  "bookingLineage",
  "planned.status !== \"ready\"",
  "catch {",
  "return null",
]) {
  if (!content.source?.includes(phrase)) errors.push(`source omits ${phrase}`);
}
for (const phrase of [
  "customer workflow derives exact parent lineage for every later step",
  "booking create and update derive exact parent lineage",
  "already-complete workflows never produce another mutation",
  "unsupported reads stop before protected dependencies",
  "zero, ambiguous, stale, and cross-organization contexts fail closed",
  "configuration drift, extra fields, and secret material fail closed",
  "invalid customer contact and impossible provider state fail closed",
  "missing and extra protected context fields fail closed",
  "unapproved services and invalid booking ranges fail closed",
  "store and resolver failures are redacted and never transported",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "Already-current state returns no plan",
  "Every returned plan is a mutation, but this source never executes it",
  "atomically claims attempt one",
  "There is no webhook",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
if (!content.runner?.includes("idempotency_key_missing") ||
  !content.runner?.includes("attempts.claim")) {
  errors.push("execution runner lost idempotency or attempt-claim enforcement");
}
const functionRoot = path.join(root, "supabase/functions");
const productionImports = [];
for (const entry of fs.readdirSync(functionRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === "_shared") continue;
  const index = path.join(functionRoot, entry.name, "index.ts");
  if (fs.existsSync(index) &&
    fs.readFileSync(index, "utf8").includes("jobtreadWritePlanSource")) {
    productionImports.push(path.relative(root, index));
  }
}
if (productionImports.length) {
  errors.push(`write-plan source unexpectedly imported: ${productionImports.join(", ")}`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread write-plan source OK: exact protected customer/booking mutations prepared; credentials, attempts, transport, runtime, and activation absent.",
);
