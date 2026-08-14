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
    "read-only hosted preflight prepared",
    "cannot safely authorize a second organization",
    "global STOP, opt-out, or test-identity gates",
    "parent coverage, orphan and cross-parent conflicts",
    "Missing, ambiguous",
    "No migration, connector, credential, sender, deployment",
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
    register.status !== "read_only_preflight_prepared" ||
    register.prepared_from_main !==
      "7c24f57258dd458978f56b0902ff05d3eecba802" ||
    register.preflight_path !== files.preflight ||
    register.preflight_bytes !== 10235 ||
    register.preflight_sha256 !==
      "36af87ed6805086b671c9ede90e09554f4f2dff408b6c0fae4cfd0a157fb8100" ||
    register.preflight_read_only !== true ||
    register.hosted_preflight_run !== false ||
    register.migration_prepared !== false ||
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
  for (const gate of gates) {
    const expected = gate.id === "consent_lineage_preflight"
      ? "ready"
      : "blocked";
    if (gate.status !== expected) {
      errors.push(`gate ${gate.id} must be ${expected}`);
    }
  }
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
  "BluLadder Klamath Phase 1H gate OK: exact read-only consent-lineage preflight prepared; hosted evidence, migration, runtime, messaging, and activation remain blocked.",
);
