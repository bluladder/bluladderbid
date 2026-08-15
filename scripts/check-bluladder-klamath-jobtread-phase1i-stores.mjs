import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  evidence:
    "docs/operations/bluladder-klamath-jobtread-phase1i-store-gates.json",
  docs: "docs/architecture/bluladder-klamath-jobtread-phase1i-stores.md",
  source: "supabase/functions/_shared/jobtreadPhase1IStores.ts",
  tests: "supabase/functions/_shared/jobtreadPhase1IStores_test.ts",
  runner: "supabase/functions/_shared/jobtreadExecutionRunner.ts",
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
  errors.push(`invalid Phase 1I store evidence: ${error.message}`);
}

if (evidence?.store_version !== 1) errors.push("store version must be one");
if (evidence?.connector_table !== "organization_crm_connectors") {
  errors.push("connector table drifted");
}
if (
  evidence?.attempt_table !==
    "organization_connector_operation_attempts"
) {
  errors.push("attempt table drifted");
}
for (
  const flag of [
    "exact_bounded_selects",
    "organization_scoped_connector_lookup",
    "direct_insert_required_for_claim",
    "ambiguous_insert_recovery_read_only",
    "fingerprint_conflict_fails_closed",
    "started_attempt_blocks_duplicate_mutation",
    "terminal_attempt_blocks_duplicate_mutation",
    "started_only_terminal_transition",
    "provider_references_persisted_as_hashes_only",
    "reconciliation_read_only",
    "postgrest_errors_redacted",
    "runtime_entrypoint_adopted",
    "protected_plan_source_implemented",
    "credential_created",
    "provider_resources_mutated",
  ]
) {
  if (evidence?.[flag] !== true) errors.push(`${flag} must be true`);
}
if (evidence?.attempt_number !== 1) {
  errors.push("attempt number must remain one");
}
for (
  const flag of [
    "ambiguous_insert_grants_ownership",
    "credential_configured",
    "credential_verified",
    "credential_value_stored_in_repository",
    "webhook_created",
    "connector_row_created",
    "provider_calls_performed",
    "hosted_mutation_performed",
    "deployment_performed",
    "activation_allowed",
    "customer_traffic_allowed",
    "jobber_or_dfw_fallback_allowed",
  ]
) {
  if (evidence?.[flag] !== false) errors.push(`${flag} must remain false`);
}

for (
  const phrase of [
    "JOBTREAD_PHASE1I_STORE_VERSION = 1",
    "organization_crm_connectors",
    "organization_connector_operation_attempts",
    "JOBTREAD_CONNECTOR_SELECT",
    "JOBTREAD_ATTEMPT_SELECT",
    'attempt_number", 1',
    "recoverAttempt",
    'status: "in_progress"',
    'status: "duplicate"',
    'status: "conflict"',
    '.eq("status", "started")',
    '.is("completed_at", null)',
    "JobTreadAttemptReconciliationStore",
  ]
) {
  if (!contents.source?.includes(phrase)) {
    errors.push(`store source omits: ${phrase}`);
  }
}
for (
  const forbidden of [
    "Deno.env",
    "createClient(",
    "fetch(",
    "setTimeout(",
    "grantKey",
    "providerOrganizationId",
  ]
) {
  if (contents.source?.includes(forbidden)) {
    errors.push(
      `store must keep side effects and secrets absent: ${forbidden}`,
    );
  }
}
for (
  const phrase of [
    "grants ownership only after the direct insert",
    "never converts ambiguity into mutation ownership",
    "fails closed when ambiguous insert cannot be reconciled exactly",
    "started-only conditional transition",
    "enforces the approved uncertainty boundary",
    "reconciliation is read-only, bounded, and sanitized",
    "rejects ambiguity, cross-organization rows, and raw errors",
  ]
) {
  if (!contents.tests?.includes(phrase)) {
    errors.push(`store tests omit: ${phrase}`);
  }
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("store tests may not be skipped");
}
for (
  const phrase of [
    "admin/service-only repository entry point",
    "does not grant ownership",
    "Recovery therefore never authorizes another provider mutation",
    "Reconciliation is read-only",
    "There is no Jobber or DFW fallback",
  ]
) {
  if (!contents.docs?.includes(phrase)) {
    errors.push(`store docs omit: ${phrase}`);
  }
}
for (
  const phrase of [
    "organization_crm_connectors",
    "organization_connector_operation_attempts",
    "idempotency_key_hash",
    "request_fingerprint",
    "provider_reference_hash",
    "outcome_uncertain",
  ]
) {
  if (!contents.schema?.includes(phrase)) {
    errors.push(`Phase 1I schema contract missing: ${phrase}`);
  }
}
for (
  const phrase of [
    "JobTreadConnectorStore",
    "JobTreadOperationAttemptStore",
    "attemptNumber: 1",
    "completeSucceeded",
    "completeManualReview",
  ]
) {
  if (!contents.runner?.includes(phrase)) {
    errors.push(`runner port contract missing: ${phrase}`);
  }
}

const functionRoot = path.join(root, "supabase/functions");
const productionImports = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (
      entry.isFile() && entry.name.endsWith(".ts") &&
      full !== path.join(root, paths.source) &&
      full !== path.join(root, paths.tests) &&
      fs.readFileSync(full, "utf8").includes("jobtreadPhase1IStores")
    ) {
      productionImports.push(path.relative(root, full));
    }
  }
}
walk(functionRoot);
const approvedRuntimeImports = [
  "supabase/functions/_shared/jobtreadKlamathReadRuntime.ts",
];
if (
  JSON.stringify(productionImports.sort()) !==
    JSON.stringify(approvedRuntimeImports)
) {
  errors.push(
    `Phase 1I store import boundary drifted: ${
      productionImports.join(", ") || "none"
    }`,
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread Phase 1I stores OK: connector lookup is reachable only through the inactive bounded read runtime; mutation ownership and reconciliation remain unreachable there.",
);
