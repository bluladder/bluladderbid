import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  evidence:
    "docs/operations/bluladder-klamath-jobtread-execution-runner-gates.json",
  docs:
    "docs/architecture/bluladder-klamath-jobtread-execution-runner.md",
  source: "supabase/functions/_shared/jobtreadExecutionRunner.ts",
  tests: "supabase/functions/_shared/jobtreadExecutionRunner_test.ts",
  mappings: "supabase/functions/_shared/jobtreadBusinessMappings.ts",
  transport: "supabase/functions/_shared/jobtreadPaveClient.ts",
  schema:
    "supabase/migrations/20260814113000_bluladder_klamath_phase_1i_crm_connector_lineage.sql",
};
const contents = {};
const errors = [];
for (const [key, relative] of Object.entries(paths)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[key] = fs.readFileSync(full, "utf8");
}

let evidence;
try {
  evidence = JSON.parse(contents.evidence ?? "{}");
} catch (error) {
  errors.push(`invalid runner evidence: ${error.message}`);
}

const approvedSteps = [
  "grant_membership_read",
  "lookup_by_external_reference",
  "create_account",
  "update_account",
  "create_contact",
  "update_contact",
  "create_location",
  "update_location",
  "read_scheduled_job_tasks",
  "create_job",
  "create_scheduled_task",
  "update_scheduled_task",
];
if (JSON.stringify(evidence?.approved_steps) !== JSON.stringify(approvedSteps)) {
  errors.push("approved runner steps drifted");
}
if (evidence?.runner_version !== 1) errors.push("runner version must be one");
for (const flag of [
  "server_owned_connector_selection",
  "server_owned_plan_source",
  "provider_organization_fingerprint_required",
  "configuration_version_required",
  "protected_secret_resolver_required",
  "canonical_sha256_request_fingerprint",
  "hashed_idempotency_required_for_mutations",
  "attempt_claimed_before_mutation",
  "step_specific_response_validation",
  "parent_lineage_echo_required",
  "schedule_echo_required",
  "outcome_uncertain_reconciliation_required",
  "provider_references_persisted_as_hashes_only",
  "sanitized_outcomes_only",
  "concrete_database_store_implemented",
  "concrete_read_plan_source_implemented",
  "customer_write_plan_source_implemented",
  "dormant_composition_implemented",
  "custom_fields_created",
  "provider_resources_mutated",
]) {
  if (evidence?.[flag] !== true) errors.push(`${flag} must be true`);
}
if (evidence?.mutation_attempt_number !== 1) {
  errors.push("mutation attempt number must remain one");
}
for (const flag of [
  "mutation_auto_retry_allowed",
  "runtime_entrypoint_adopted",
  "credential_created",
  "credential_value_stored_in_repository",
  "protected_custom_field_bindings_recorded",
  "webhook_created",
  "connector_row_created",
  "provider_calls_performed",
  "hosted_mutation_performed",
  "deployment_performed",
  "activation_allowed",
  "customer_traffic_allowed",
  "jobber_or_dfw_fallback_allowed",
]) {
  if (evidence?.[flag] !== false) errors.push(`${flag} must remain false`);
}

for (const phrase of [
  "JOBTREAD_EXECUTION_RUNNER_VERSION = 1",
  "JOBTREAD_EXECUTABLE_STEPS",
  "JobTreadPreparedPlanSource",
  "JobTreadProtectedCredentialResolver",
  "JobTreadOperationAttemptStore",
  "canonicalJobTreadJson",
  "sha256Hex",
  "validatePlanLineage",
  "validateProviderResponse",
  "attemptNumber: 1",
  "claim",
  "completeManualReview",
  "outcomeUncertain",
  "providerReferenceHash",
]) {
  if (!contents.source?.includes(phrase)) {
    errors.push(`runner source omits: ${phrase}`);
  }
}
for (const forbidden of [
  "Deno.env",
  "createClient(",
  "fetch(",
  "JOBTREAD_PAVE_ENDPOINT",
  "setTimeout(",
]) {
  if (contents.source?.includes(forbidden)) {
    errors.push(`runner must keep side effects injected: ${forbidden}`);
  }
}
const publicRequest = contents.source?.match(
  /export interface JobTreadExecutionRequest \{([\s\S]*?)\n\}/,
)?.[1] ?? "";
for (const forbidden of [
  "query",
  "providerOrganization",
  "connectorId",
  "credentialReference",
  "grantKey",
  "mutation",
  "retry",
]) {
  if (publicRequest.includes(forbidden)) {
    errors.push(`public request may not accept ${forbidden}`);
  }
}
for (const phrase of [
  "resolves one exact active organization connector",
  "rejects configuration and provider fingerprint drift before credentials",
  "caller cannot supply a query",
  "claims a mutation before exactly one transport call",
  "validates every customer parent lineage echo",
  "blocks duplicate and in-progress writes",
  "uncertain transport outcome terminal with no retry",
  "malformed mutation success as uncertain reconciliation",
  "never expose grants, requests, or provider references",
]) {
  if (!contents.tests?.includes(phrase)) {
    errors.push(`runner tests omit: ${phrase}`);
  }
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("runner tests may not be skipped");
}
for (const phrase of [
  "No production Edge",
  "never retries a mutation",
  "There is no Jobber, DFW",
  "deliberately unreachable",
]) {
  if (!contents.docs?.includes(phrase)) {
    errors.push(`runner docs omit: ${phrase}`);
  }
}
for (const phrase of [
  "organization_connector_operation_attempts",
  "idempotency_key_hash",
  "request_fingerprint",
  "provider_reference_hash",
  "outcome_uncertain",
  "attempt_number BETWEEN 1 AND 10",
]) {
  if (!contents.schema?.includes(phrase)) {
    errors.push(`Phase 1I schema contract missing: ${phrase}`);
  }
}
if (!contents.transport?.includes("request.mutation === true") ||
  !contents.transport?.includes("outcomeUncertain")) {
  errors.push("transport lost uncertain-write protection");
}
if (!contents.mappings?.includes("JOBTREAD_APPROVED_MAPPING_CAPABILITIES")) {
  errors.push("business mapping allow-list missing");
}

const functionRoot = path.join(root, "supabase/functions");
const productionImports = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".ts") &&
      full !== path.join(root, paths.source) &&
      full !== path.join(root, paths.tests) &&
      !full.endsWith("jobtreadPhase1IStores.ts") &&
      !full.endsWith("jobtreadPhase1IStores_test.ts") &&
      !full.endsWith("jobtreadReadPlanSource.ts") &&
      !full.endsWith("jobtreadReadPlanSource_test.ts") &&
      !full.endsWith("jobtreadWritePlanSource.ts") &&
      !full.endsWith("jobtreadWritePlanSource_test.ts") &&
      !full.endsWith("jobtreadExecutionComposition.ts") &&
      !full.endsWith("jobtreadExecutionComposition_test.ts") &&
      !full.endsWith("jobtreadKlamathProtectedConfiguration.ts") &&
      !full.endsWith("jobtreadKlamathProtectedConfiguration_test.ts") &&
      fs.readFileSync(full, "utf8").includes("jobtreadExecutionRunner")) {
      productionImports.push(path.relative(root, full));
    }
  }
}
walk(functionRoot);
if (productionImports.length) {
  errors.push(`runner became reachable from: ${productionImports.join(", ")}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread runner OK: exact dormant single-attempt execution contract prepared; credentials, provider traffic, runtime, and activation remain absent.",
);
