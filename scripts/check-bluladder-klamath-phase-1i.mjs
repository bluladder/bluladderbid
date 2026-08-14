import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1i-crm-connector-lineage.md",
  register: "docs/operations/bluladder-klamath-phase-1i-gates.json",
  preflight:
    "supabase/preflight/bluladder_klamath_phase_1i_crm_connector_lineage.sql",
  migration:
    "supabase/migrations/20260814113000_bluladder_klamath_phase_1i_crm_connector_lineage.sql",
  receipt:
    "supabase/migrations/20260814113042_6b2ca260-f192-47db-a9de-28674a5843e0.sql",
  verification:
    "supabase/verification/bluladder_klamath_phase_1i_crm_connector_lineage.sql",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1i-crm-connector-postgres.sh",
  capability:
    "docs/operations/bluladder-klamath-jobtread-capability-gates.json",
  types: "src/integrations/supabase/types.ts",
  package: "package.json",
  workflow: ".github/workflows/ci.yml",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
};

const content = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) {
    errors.push(`${files[key]} omits: ${text}`);
  }
}

for (
  const text of [
    "hosted additive schema and least-privilege grants verified",
    "organization_crm_connectors",
    "organization_connector_operation_attempts",
    "organization_connector_webhook_receipts",
    "opaque protected-secret references",
    "represented only by lowercase SHA-256",
    "composite foreign keys",
    "Uncertain provider outcomes are terminal manual",
    "The migration inserts no rows",
    "Only `service_role` may write those",
    "There is no Jobber or DFW fallback for Klamath",
  ]
) requireText("contract", text);

for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "SET LOCAL statement_timeout",
    "SET LOCAL lock_timeout",
    "prerequisite_table_count",
    "target_table_count",
    "exact_dfw_default_count",
    "exact_klamath_provisioning_count",
    "klamath_customer_count",
    "klamath_provider_identity_count",
    "ROLLBACK",
  ]
) requireText("preflight", text);

for (
  const text of [
    "Phase 1I target tables already exist",
    "Phase 1I requires zero Klamath customer traffic",
    "Phase 1I requires zero Klamath provider identities",
    "organization_crm_connectors_runtime_gate_check",
    "organization_crm_connectors_webhook_gate_check",
    "organization_connector_operation_attempts_connector_fkey",
    "organization_connector_webhook_receipts_connector_fkey",
    "organization_connector_operation_attempts_idempotency_key",
    "organization_connector_webhook_receipts_idempotency_key",
    "source_authenticated boolean NOT NULL CHECK (source_authenticated)",
    "Tenant operators view CRM connectors",
    "Tenant operators manage CRM connectors",
    "Tenant operators view CRM operation attempts",
    "Tenant operators view CRM webhook receipts",
  ]
) requireText("migration", text);

for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "rls_enabled_table_count",
    "connector_policy_count",
    "operation_policy_count",
    "webhook_policy_count",
    "anon_grant_count",
    "authenticated_operation_grant_count",
    "forbidden_column_count",
    "klamath_provider_identity_count",
    "ROLLBACK",
  ]
) requireText("verification", text);

for (
  const text of [
    "BLULADDER_KLAMATH_PHASE1I_DATABASE_URL",
    "Phase 1I migration created runtime data",
    "connector activated without protected references",
    "duplicate operation idempotency was accepted",
    "cross-organization connector lineage was accepted",
    "unauthenticated webhook receipt was accepted",
    "duplicate webhook event was accepted",
    "Phase 1I CRM connector lineage rehearsal passed",
  ]
) requireText("rehearsal", text);

const ddlPattern =
  /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i;
for (const key of ["preflight", "verification"]) {
  const sql = (content[key] ?? "").replace(/^\s*--.*$/gm, "");
  if (ddlPattern.test(sql)) {
    errors.push(`${files[key]} contains a write or DDL statement`);
  }
}

if (
  /^\s+(?:credential|secret|token|headers|request_body|response_body|payload|customer_data|provider_organization_id|provider_event_id)\s+/im
    .test(content.migration ?? "")
) {
  errors.push("Phase 1I schema contains a prohibited raw sensitive column");
}

if (/^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\b/im.test(content.migration ?? "")) {
  errors.push("Phase 1I migration must create no rows or mutate existing rows");
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1I gate JSON is invalid: ${error.message}`);
}

const artifactExpectations = {
  preflight: [3609, "f6f62f515d5021f0d1aea19c001cd88efdf2575acc7d695f35255f1f60140011"],
  migration: [13541, "9ebd804bb45d3fd523f5b38803c0bddfce5450cf874ff8ccb440ce1f8a865b95"],
  verification: [7655, "0ddbd1b88b56aefac16bde2897c0bfe0b15dddc5aff142d6adc4485046f1f668"],
  rehearsal: [8732, "50a66b83e4a558b701801110e6aa863223918573983d45ed763216c73d87a9a1"],
};

for (const [key, [expectedBytes, expectedSha]] of Object.entries(
  artifactExpectations,
)) {
  const actual = content[key] ?? "";
  const actualBytes = Buffer.byteLength(actual);
  const actualSha = createHash("sha256").update(actual).digest("hex");
  if (actualBytes !== expectedBytes || actualSha !== expectedSha) {
    errors.push(`Phase 1I ${key} artifact identity drifted`);
  }
  if (
    register?.[`${key}_bytes`] !== expectedBytes ||
    register?.[`${key}_sha256`] !== expectedSha
  ) {
    errors.push(`Phase 1I ${key} register identity drifted`);
  }
}

if (
  !(content.migration ?? "").endsWith("\n") ||
  content.receipt !== (content.migration ?? "").slice(0, -1) ||
  Buffer.byteLength(content.receipt ?? "") !== 13540 ||
  createHash("sha256").update(content.receipt ?? "").digest("hex") !==
    "8d6752dd11393ac1dce26af491499b3f0a8a29713d9eb0b42225b46a7ddc86ea"
) {
  errors.push("Phase 1I Lovable receipt does not match canonical terminal-LF normalization");
}

for (const table of [
  "organization_crm_connectors",
  "organization_connector_operation_attempts",
  "organization_connector_webhook_receipts",
]) requireText("types", table);

if (register) {
  if (
    register.phase !== "1I" ||
    register.status !== "hosted_schema_and_grants_verified" ||
    register.prepared_from_main !==
      "c3542252c1b8949285577602a2119ff5e0501999" ||
    register.preflight_path !== files.preflight ||
    register.migration_path !== files.migration ||
    register.verification_path !== files.verification ||
    register.rehearsal_path !== files.rehearsal ||
    register.preflight_read_only !== true ||
    register.migration_prepared !== true ||
    register.hosted_preflight_run !== true ||
    register.migration_applied !== true ||
    register.hosted_receipt_present !== true ||
    register.hosted_execution_version !== "20260814113042" ||
    register.hosted_ledger_count !== 163 ||
    register.hosted_ledger_fingerprint !==
      "7c3c773c03c2f8dd822d3a987cf7e7b5d7c02c6d9d5c3f3ded4e1ff20184dc66" ||
    register.hosted_statement_bytes !== 13540 ||
    register.hosted_statement_sha256 !==
      "8d6752dd11393ac1dce26af491499b3f0a8a29713d9eb0b42225b46a7ddc86ea" ||
    register.authenticated_grant_repair_required !== false ||
    register.authenticated_grant_repair_execution_version !== "20260814120308" ||
    register.hosted_ledger_count_after_grant_repair !== 164 ||
    register.hosted_ledger_fingerprint_after_grant_repair !==
      "ee68da23b599f4c9d18c5013ef9510680d8d0818cba5850000f13f248b242b8b" ||
    register.runtime_prepared !== false ||
    register.runtime_deployed !== false ||
    register.activation_allowed !== false ||
    register.customer_traffic_allowed !== false ||
    register.provider_actions_allowed !== false ||
    Object.values(register.authorized_actions ?? {}).some(Boolean)
  ) {
    errors.push("Phase 1I repository release boundary drifted");
  }

  const schema = register.schema_contract ?? {};
  if (
    schema.target_table_count !== 3 ||
    schema.connector_policy_count !== 2 ||
    schema.operation_policy_count !== 1 ||
    schema.webhook_policy_count !== 1 ||
    schema.anonymous_access !== false ||
    schema.authenticated_audit_writes !== false ||
    schema.raw_secrets_or_payloads !== false ||
    schema.composite_organization_connector_lineage !== true ||
    schema.hashed_operation_idempotency !== true ||
    schema.hashed_webhook_idempotency !== true ||
    schema.creates_rows !== false
  ) {
    errors.push("Phase 1I schema register drifted");
  }

  const expectedGates = new Map([
    ["jobtread_provider_capability", "passed"],
    ["connector_lineage_repository_candidate", "passed"],
    ["hosted_read_only_preflight", "passed"],
    ["connector_lineage_migration", "passed"],
    ["authenticated_grant_repair", "passed"],
    ["jobtread_business_mapping", "blocked"],
    ["credential_and_webhook", "blocked"],
    ["runtime_adoption_and_deployment", "blocked"],
    ["controlled_acceptance", "blocked"],
    ["customer_traffic_activation", "blocked"],
  ]);
  const gates = register.gates ?? [];
  if (
    gates.length !== expectedGates.size ||
    new Set(gates.map((gate) => gate.id)).size !== expectedGates.size
  ) {
    errors.push("Phase 1I gate identity/count drifted");
  }
  for (const gate of gates) {
    if (expectedGates.get(gate.id) !== gate.status) {
      errors.push(`Phase 1I gate ${gate.id} drifted`);
    }
  }
}

let capability;
try {
  capability = JSON.parse(content.capability ?? "{}");
} catch (error) {
  errors.push(`JobTread capability JSON is invalid: ${error.message}`);
}
if (
  capability?.provider_account_uniquely_matched !== true ||
  capability?.dormant_adapter_prepared !== true ||
  capability?.runtime_entrypoint_adopted !== false ||
  capability?.grant_created !== true ||
  capability?.credential_configured !== false ||
  capability?.credential_verified !== false ||
  capability?.webhook_created !== false
) {
  errors.push("Phase 1I requires the verified, dormant JobTread baseline");
}

requireText("package", '"check:klamath-phase-1i"');
requireText("workflow", "bun run check:klamath-phase-1i");
requireText("workflow", "Rehearse BluLadder Klamath Phase 1I CRM connector lineage");
requireText("roadmap", "Klamath Phase 1I dormant CRM connector lineage");
requireText("roadmap", "Lovable-hydrated authenticated privileges");
requireText("roadmap", "forward-only repair is now applied and verified");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1I gate OK: hosted CRM lineage and least-privilege grants are verified while all provider/runtime/traffic actions remain blocked.",
);
