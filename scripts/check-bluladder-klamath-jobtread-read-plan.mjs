import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  source: "supabase/functions/_shared/jobtreadReadPlanSource.ts",
  tests: "supabase/functions/_shared/jobtreadReadPlanSource_test.ts",
  contract:
    "docs/architecture/bluladder-klamath-jobtread-read-plan-source.md",
  register:
    "docs/operations/bluladder-klamath-jobtread-read-plan-gates.json",
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
  write_capabilities_allowed: false,
  caller_provider_authority_allowed: false,
  caller_query_allowed: false,
  caller_credential_allowed: false,
  exact_one_server_context_required: true,
  protected_configuration_required: true,
  organization_lineage_required: true,
  configuration_version_match_required: true,
  context_maximum_lifetime_seconds: 300,
  approved_service_keys_required: true,
  bounded_schedule_range_required: true,
  provider_transport_executed: false,
  operation_attempt_created: false,
  customer_payload_persisted: false,
  production_imported: false,
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
  JSON.stringify(register?.approved_capabilities) !==
    JSON.stringify(["health", "availability_read"])
) errors.push("approved read capability set drifted");

for (const phrase of [
  'value === "health" || value === "availability_read"',
  "contexts.length !== 1",
  "planJobTreadHealthCheck",
  "planJobTreadAvailabilityRead",
  "expectedLineage: {}",
  "catch {",
  "return null",
]) {
  if (!content.source?.includes(phrase)) errors.push(`source omits ${phrase}`);
}
for (const phrase of [
  "unsupported write capabilities stop before protected dependencies",
  "zero or ambiguous contexts fail closed",
  "organization, capability, reference, and version drift fail closed",
  "unapproved services and invalid schedule ranges fail closed",
  "extra fields including secrets and provider identifiers fail closed",
  "private store and resolver errors are redacted to null",
  "expired or excessively long-lived contexts fail closed",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "accept a provider organization, provider query",
  "page is not treated as complete availability",
  "never resolves a credential",
  "JobTread remains server initiated with no webhook",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
if (!content.runner?.includes("plans.load({")) {
  errors.push("execution runner no longer consumes a protected plan source");
}

const productionFiles = [];
for (const entry of fs.readdirSync(path.join(root, "supabase/functions"), {
  withFileTypes: true,
})) {
  if (!entry.isDirectory() || entry.name === "_shared") continue;
  const index = path.join(root, "supabase/functions", entry.name, "index.ts");
  if (
    fs.existsSync(index) &&
    fs.readFileSync(index, "utf8").includes("jobtreadReadPlanSource")
  ) productionFiles.push(path.relative(root, index));
}
if (productionFiles.length) {
  errors.push(`read-plan source unexpectedly imported: ${productionFiles.join(", ")}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread read-plan source OK: exact server-owned health/availability reads prepared; credentials, writes, transport, and runtime absent.",
);
