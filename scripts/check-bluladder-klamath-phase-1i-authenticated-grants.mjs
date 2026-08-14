import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1i-authenticated-grants.md",
  register:
    "docs/operations/bluladder-klamath-phase-1i-authenticated-grants-gates.json",
  preflight:
    "supabase/preflight/bluladder_klamath_phase_1i_authenticated_grants.sql",
  migration:
    "supabase/migrations/20260814114500_bluladder_klamath_phase_1i_authenticated_grants.sql",
  receipt:
    "supabase/migrations/20260814120308_dedb44f7-f5c6-4621-9387-e88691c6969b.sql",
  verification:
    "supabase/verification/bluladder_klamath_phase_1i_authenticated_grants.sql",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1i-authenticated-grants-postgres.sh",
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
  if (!content[key]?.includes(text)) errors.push(`${files[key]} omits: ${text}`);
}

for (const text of [
  "hosted repair applied and independently verified",
  "Lovable-hosted table creation hydrated all seven table privileges",
  "organization_crm_connectors` to `SELECT`, `INSERT`, `UPDATE`, and `DELETE",
  "organization_connector_operation_attempts` to `SELECT` only",
  "organization_connector_webhook_receipts` to `SELECT` only",
  "Anonymous denial and all seven `service_role` privileges remain unchanged",
  "creates no connector",
]) requireText("contract", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY",
  "SET LOCAL statement_timeout",
  "SET LOCAL lock_timeout",
  "authenticated_grants",
  "anon_grant_count",
  "service_role_grant_count",
  "exact_dfw_default_count",
  "exact_klamath_provisioning_count",
  "klamath_provider_identity_count",
  "ROLLBACK",
]) requireText("preflight", text);

for (const text of [
  "Phase 1I authenticated privilege drift is not observed state",
  "Phase 1I policy state is not exact",
  "Phase 1I grant repair requires empty connector tables",
  "Phase 1I DFW authority changed",
  "Phase 1I Klamath inactive boundary changed",
  "REVOKE ALL PRIVILEGES",
  "GRANT SELECT, INSERT, UPDATE, DELETE",
  "Phase 1I audit privileges were not narrowed",
  "Phase 1I authenticated role retains excess privileges",
  "Phase 1I grant repair changed data",
]) requireText("migration", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY",
  "authenticated_excess_privilege_count",
  "rls_enabled_table_count",
  "connector_policy_count",
  "operation_policy_count",
  "webhook_policy_count",
  "klamath_provider_identity_count",
  "ROLLBACK",
]) requireText("verification", text);

for (const text of [
  "BLULADDER_KLAMATH_PHASE1I_GRANTS_DATABASE_URL",
  "Reproduce the exact Lovable-hosted privilege hydration",
  "authenticated connector grants were not repaired",
  "authenticated audit grants were not narrowed to SELECT",
  "grant repair changed rehearsal data",
  "Phase 1I authenticated-grant repair rehearsal passed",
]) requireText("rehearsal", text);

const ddlPattern =
  /^\s*(?:INSERT INTO|UPDATE\s+|DELETE FROM|ALTER\s+|CREATE\s+|DROP\s+|TRUNCATE\s+|GRANT\s+|REVOKE\s+)/im;
for (const key of ["preflight", "verification"]) {
  const sql = (content[key] ?? "").replace(/^\s*--.*$/gm, "");
  if (ddlPattern.test(sql)) errors.push(`${files[key]} is not read-only`);
}

if (/^\s*(?:INSERT INTO|UPDATE\s+public\.|DELETE FROM)\b/im.test(
  content.migration ?? "",
)) {
  errors.push("Phase 1I grant repair contains a row mutation");
}
for (const prohibited of [
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "CREATE POLICY",
  "DROP POLICY",
  "CREATE FUNCTION",
  "CREATE OR REPLACE FUNCTION",
]) {
  if ((content.migration ?? "").includes(prohibited)) {
    errors.push(`Phase 1I grant repair includes prohibited ${prohibited}`);
  }
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1I grant gate JSON is invalid: ${error.message}`);
}

const artifactExpectations = {
  preflight: [5158, "f88f6c9f32c5df09bbaa53648582ec077344fcaec9e6555e163397bb8e41db66"],
  migration: [9901, "07e051b649047263c94e11709a30e01360f15616eca2b5c9da183a6ea3b0ee82"],
  verification: [6132, "9e156bbff17b5700c1d7c8c2c8b2ef3cb657b8f42805e9709d913ee71c29b7ab"],
  rehearsal: [2800, "cb2c0d1991efc74ef37307b58ebd9567fa8024c7602a16988e13390ff7aaec40"],
};
for (const [key, [expectedBytes, expectedSha]] of Object.entries(
  artifactExpectations,
)) {
  const actual = content[key] ?? "";
  const actualBytes = Buffer.byteLength(actual);
  const actualSha = createHash("sha256").update(actual).digest("hex");
  if (actualBytes !== expectedBytes || actualSha !== expectedSha) {
    errors.push(`Phase 1I grant ${key} artifact identity drifted`);
  }
  if (
    register?.[`${key}_bytes`] !== expectedBytes ||
    register?.[`${key}_sha256`] !== expectedSha
  ) {
    errors.push(`Phase 1I grant ${key} register identity drifted`);
  }
}

if (
  !(content.migration ?? "").endsWith("\n") ||
  content.receipt !== (content.migration ?? "").slice(0, -1) ||
  Buffer.byteLength(content.receipt ?? "") !== 9900 ||
  createHash("sha256").update(content.receipt ?? "").digest("hex") !==
    "83958eb709524e1a4e8b53db1c166e9e0fc8e87b3936abed2776153a8c5364ce"
) errors.push("Phase 1I grant receipt is not the canonical terminal-LF normalization");

if (register) {
  if (
    register.phase !== "1I-authenticated-grants" ||
    register.status !== "hosted_repair_applied_and_verified" ||
    register.prepared_from_main !== "0975d457327fbfccf3f802e6d06d1f301719c3a7" ||
    register.issue !== 139 ||
    register.reconciliation_issue !== 141 ||
    register.preflight_path !== files.preflight ||
    register.migration_path !== files.migration ||
    register.verification_path !== files.verification ||
    register.rehearsal_path !== files.rehearsal ||
    register.preflight_read_only !== true ||
    register.verification_read_only !== true ||
    register.hosted_execution_version_before_repair !== "20260814113042" ||
    register.hosted_ledger_count_before_repair !== 163 ||
    register.hosted_execution_version !== "20260814120308" ||
    register.hosted_ledger_count !== 164 ||
    register.hosted_ledger_fingerprint !==
      "ee68da23b599f4c9d18c5013ef9510680d8d0818cba5850000f13f248b242b8b" ||
    register.hosted_statement_bytes !== 9900 ||
    register.hosted_statement_sha256 !==
      "83958eb709524e1a4e8b53db1c166e9e0fc8e87b3936abed2776153a8c5364ce" ||
    register.receipt_path !== files.receipt ||
    register.rows_changed !== false ||
    register.policies_changed !== false ||
    register.anonymous_access_changed !== false ||
    register.service_role_access_changed !== false ||
    register.runtime_changed !== false ||
    register.provider_actions_allowed !== false ||
    register.customer_traffic_allowed !== false
  ) errors.push("Phase 1I grant repair boundary drifted");

  const expectedObserved = [
    "DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE",
  ];
  if (
    JSON.stringify(register.observed_authenticated_privileges) !==
      JSON.stringify(expectedObserved) ||
    JSON.stringify(register.expected_connector_privileges) !==
      JSON.stringify(["DELETE", "INSERT", "SELECT", "UPDATE"]) ||
    JSON.stringify(register.expected_audit_privileges) !==
      JSON.stringify(["SELECT"])
  ) errors.push("Phase 1I grant arrays drifted");

  const expectedGates = new Map([
    ["hosted_observed_state", "passed"],
    ["repository_repair", "passed"],
    ["exact_head_ci", "passed"],
    ["secret_scan", "passed"],
    ["hosted_repair_application", "passed"],
    ["hosted_postflight", "passed"],
    ["jobtread_provider_setup", "blocked"],
    ["runtime_adoption", "blocked"],
    ["customer_traffic_activation", "blocked"],
  ]);
  const gates = register.gates ?? [];
  if (
    gates.length !== expectedGates.size ||
    new Set(gates.map((gate) => gate.id)).size !== expectedGates.size
  ) errors.push("Phase 1I grant gate count drifted");
  for (const gate of gates) {
    if (expectedGates.get(gate.id) !== gate.status) {
      errors.push(`Phase 1I grant gate ${gate.id} drifted`);
    }
  }
}

requireText("package", '"check:klamath-phase-1i-grants"');
requireText("workflow", "bun run check:klamath-phase-1i-grants");
requireText("workflow", "Rehearse BluLadder Klamath Phase 1I authenticated grants");
requireText("roadmap", "forward-only repair is now applied and verified");

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1I grant gate OK: hosted connector CRUD and audit SELECT are verified while provider/runtime/traffic actions remain blocked.",
);
