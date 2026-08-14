import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract: "docs/architecture/bluladder-klamath-phase-1h-consent-lineage.md",
  register: "docs/operations/bluladder-klamath-phase-1h-gates.json",
  preflight:
    "supabase/preflight/bluladder_klamath_phase_1h_consent_lineage.sql",
  migration:
    "supabase/migrations/20260814102000_bluladder_klamath_phase_1h_organization_consent_lineage.sql",
  verification:
    "supabase/verification/bluladder_klamath_phase_1h_organization_consent_lineage.sql",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1h-consent-lineage-postgres.sh",
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
    "hosted preflight passed; fail-closed migration candidate prepared",
    "cannot safely authorize a second organization",
    "global STOP, opt-out, or test-identity gates",
    "parent coverage, orphan and cross-parent conflicts",
    "Missing, ambiguous",
    "seven consent rows and twenty consent-event rows",
    "It is not a runtime `coalesce` or cross-tenant fallback",
    "record_organization_consent",
    "No hosted migration, connector, credential, sender, deployment",
  ]
) requireText("contract", text);

for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "SET LOCAL statement_timeout",
    "SET LOCAL lock_timeout",
    "prerequisite_table_count",
    "consent_organization_column_count",
    "event_organization_column_count",
    "record_organization_consent",
    "consent_allows_for_organization",
    "parent_conflict_count",
    "orphan_parent_count",
    "non_dfw_parent_count",
    "projected_identity_collision_count",
    "orphan_consent_event_count",
    "projected_klamath_consent_count",
    "consent_rls_enabled_count",
    "consent_event_rls_enabled_count",
    "ROLLBACK",
  ]
) requireText("preflight", text);

for (
  const text of [
    "Phase 1H consent parent authority requires reconciliation",
    "Phase 1H organization-scoped identity collision",
    "Parentless historical rows are explicitly assigned",
    "uq_consent_organization_sms",
    "uq_consent_organization_email",
    "enforce_communication_consent_organization_lineage",
    "enforce_communication_consent_event_organization_lineage",
    "record_organization_consent",
    "consent_allows_for_organization",
    "Existing DFW-only callers retain their signatures",
    "Tenant members view consent",
    "Tenant operators manage consent",
    "Tenant members view consent history",
    "historical lineage escaped DFW",
  ]
) requireText("migration", text);

for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "consent_required_organization_column_count",
    "historical_non_dfw_consent_count",
    "event_parent_mismatch_count",
    "legacy_global_unique_index_count",
    "organization_record_function_count",
    "authenticated_record_execute",
    "consent_lineage_trigger_count",
    "klamath_consent_count",
    "ROLLBACK",
  ]
) requireText("verification", text);

for (
  const text of [
    "BLULADDER_KLAMATH_PHASE1H_DATABASE_URL",
    "Phase 1H migration changed historical row counts",
    "Phase 1H explicit DFW backfill failed",
    "provisioning organization recorded consent",
    "organization-scoped consent identity was not isolated",
    "cross-organization parent consent was accepted",
    "Phase 1H consent-lineage rehearsal passed",
  ]
) requireText("rehearsal", text);

if (
  /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
    (content.preflight ?? "").replace(/^\s*--.*$/gm, ""),
  )
) {
  errors.push("Phase 1H preflight contains a write or DDL statement");
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1H gate JSON is invalid: ${error.message}`);
}
if (register) {
  if (
    register.phase !== "1H" ||
    register.status !== "migration_candidate_prepared" ||
    register.prepared_from_main !==
      "c5ff16e056b09a727cb84d1838e5245e7da43af8" ||
    register.preflight_path !== files.preflight ||
    register.preflight_bytes !== 10235 ||
    register.preflight_sha256 !==
      "36af87ed6805086b671c9ede90e09554f4f2dff408b6c0fae4cfd0a157fb8100" ||
    register.preflight_read_only !== true ||
    register.hosted_preflight_run !== true ||
    register.hosted_preflight_rolled_back !== true ||
    register.migration_path !== files.migration ||
    register.migration_bytes !== 24847 ||
    register.migration_sha256 !==
      "0dfec1d3fbf665e88093bc365e41862d38736ee70dc7d1a527bc52dfb234e110" ||
    register.verification_path !== files.verification ||
    register.verification_bytes !== 5903 ||
    register.verification_sha256 !==
      "c96a8efd09952bd91e1b4985e4f284dd903bff9100efd81dc064584f810e0bfe" ||
    register.rehearsal_path !== files.rehearsal ||
    register.rehearsal_bytes !== 12126 ||
    register.rehearsal_sha256 !==
      "6f2a2285c8af864e03af15772bb3586be7200dc9e347a199a14cec7e3f29adbb" ||
    register.migration_prepared !== true ||
    register.migration_applied !== false ||
    register.runtime_prepared !== false ||
    register.runtime_deployed !== false ||
    register.activation_allowed !== false ||
    register.customer_traffic_allowed !== false ||
    register.messages_authorized !== false ||
    Object.values(register.authorized_actions ?? {}).some(Boolean)
  ) errors.push("Phase 1H repository contract drifted");

  const gates = register.gates ?? [];
  if (gates.length !== 6 || new Set(gates.map((gate) => gate.id)).size !== 6) {
    errors.push("Phase 1H gate identity/count drifted");
  }
  const expectedGates = {
    consent_lineage_preflight: "passed",
    hosted_consent_evidence: "passed",
    consent_lineage_migration: "ready",
    consent_runtime_adoption: "blocked",
    controlled_message_acceptance: "blocked",
    customer_traffic_activation: "blocked",
  };
  for (const gate of gates) {
    const expected = expectedGates[gate.id];
    if (gate.status !== expected) {
      errors.push(`gate ${gate.id} must be ${expected}`);
    }
  }
}

for (
  const [key, expectedBytes, expectedSha] of [
    [
      "migration",
      24847,
      "0dfec1d3fbf665e88093bc365e41862d38736ee70dc7d1a527bc52dfb234e110",
    ],
    [
      "verification",
      5903,
      "c96a8efd09952bd91e1b4985e4f284dd903bff9100efd81dc064584f810e0bfe",
    ],
    [
      "rehearsal",
      12126,
      "6f2a2285c8af864e03af15772bb3586be7200dc9e347a199a14cec7e3f29adbb",
    ],
  ]
) {
  if (Buffer.byteLength(content[key] ?? "") !== expectedBytes) {
    errors.push(`Phase 1H ${key} byte size drifted`);
  }
  if (
    createHash("sha256").update(content[key] ?? "").digest("hex") !==
      expectedSha
  ) errors.push(`Phase 1H ${key} SHA-256 drifted`);
}

if (content.preflight) {
  if (Buffer.byteLength(content.preflight) !== 10235) {
    errors.push("Phase 1H preflight byte size drifted");
  }
  if (
    createHash("sha256").update(content.preflight).digest("hex") !==
      "36af87ed6805086b671c9ede90e09554f4f2dff408b6c0fae4cfd0a157fb8100"
  ) errors.push("Phase 1H preflight SHA-256 drifted");
}

requireText("package", '"check:klamath-phase-1h"');
requireText("workflow", "bun run check:klamath-phase-1h");
requireText("roadmap", "Klamath Phase 1H consent lineage");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1H gate OK: hosted preflight passed and exact consent-lineage migration candidate prepared; hosted application, runtime, messaging, and activation remain blocked.",
);
