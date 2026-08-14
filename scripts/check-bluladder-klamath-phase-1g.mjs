import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1g-messaging-outbox-lineage.md",
  register: "docs/operations/bluladder-klamath-phase-1g-gates.json",
  connector:
    "supabase/functions/_shared/messagingConnectorContracts.ts",
  tests:
    "supabase/functions/_shared/messagingConnectorContracts_test.ts",
  migration:
    "supabase/migrations/20260814070000_bluladder_klamath_phase_1g_additive_messaging_lineage.sql",
  preflight:
    "supabase/preflight/bluladder_klamath_phase_1g_additive_messaging_lineage.sql",
  verification:
    "supabase/verification/bluladder_klamath_phase_1g_additive_messaging_lineage.sql",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1g-additive-messaging-postgres.sh",
  grantMigration:
    "supabase/migrations/20260814071600_bluladder_klamath_phase_1g_authenticated_grants.sql",
  grantPreflight:
    "supabase/preflight/bluladder_klamath_phase_1g_authenticated_grants.sql",
  grantVerification:
    "supabase/verification/bluladder_klamath_phase_1g_authenticated_grants.sql",
  grantRehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1g-authenticated-grants-postgres.sh",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
  workflow: ".github/workflows/ci.yml",
};

const content = {};
const errors = [];
for (const [key, file] of Object.entries(relative)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) errors.push(`missing ${file}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) errors.push(`${relative[key]} omits: ${text}`);
}

for (const text of [
  "hosted additive schema applied; least-privilege repair and runtime",
  "Recipient identity, caller ID, browser input, message content",
  "Failure never falls back to DFW",
  "Platform/legal safety suppressions remain global",
  "No schema application may create an active Klamath connector",
  "134 historical messaging-ledger rows",
  "28 have a server-owned parent",
  "106 are legacy unparented rows",
  "version `20260814071137`",
  "`REFERENCES`, `TRIGGER`, and `TRUNCATE`",
]) requireText("contract", text);

for (const text of [
  'export type MessagingProvider = "callrail" | "twilio" | "resend"',
  "selectOrganizationMessagingConnector",
  "connector_ambiguous",
  "credential_reference_missing",
  "sender_identity_missing",
  "guardMessagingDispatch",
  "organization_lineage_mismatch",
  "idempotency_key_missing",
]) requireText("connector", text);

for (const text of [
  "never falls back across organizations",
  "inactive, ambiguous, and incomplete senders fail closed",
  "dispatch guard binds organization, connector, channel, and key",
]) requireText("tests", text);

for (const text of [
  "CREATE TABLE public.organization_messaging_connectors",
  "ADD COLUMN organization_id uuid",
  "ADD COLUMN messaging_connector_id uuid",
  "enforce_sms_message_organization_lineage",
  "migration unexpectedly created a connector",
  "historical SMS escaped the DFW boundary",
]) requireText("migration", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY",
  "prerequisite_table_count",
  "parent_conflict_count",
  "non_dfw_parent_count",
  "klamath_provider_identity_count",
  "lineage_function_count",
  "ROLLBACK",
]) requireText("preflight", text);

for (const text of [
  "connector_count",
  "nullable_organization_column_count",
  "missing_organization_count",
  "connector_policy_count",
  "lineage_trigger_count",
  "anon_execute_count",
  "klamath_active_count",
]) requireText("verification", text);

for (const text of [
  "BLULADDER_KLAMATH_PHASE1G_DATABASE_URL",
  "server-parent lineage derivation failed",
  "cross-organization parent lineage was accepted",
  "cross-channel connector lineage was accepted",
  "Phase 1G additive messaging lineage rehearsal passed",
]) requireText("rehearsal", text);

for (const text of [
  "Phase 1G authenticated privilege drift is not the observed state",
  "REVOKE ALL PRIVILEGES",
  "GRANT SELECT, INSERT, UPDATE, DELETE",
  "Phase 1G authenticated role retains excess access",
  "Phase 1G grant repair changed data",
]) requireText("grantMigration", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY",
  "authenticated_privileges",
  "connector_bound_count",
  "klamath_provisioning_count",
  "ROLLBACK",
]) requireText("grantPreflight", text);

for (const text of [
  "authenticated_excess_privilege_count",
  "service_role_privilege_count",
  "missing_organization_count",
  "klamath_active_count",
]) requireText("grantVerification", text);

for (const text of [
  "BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL",
  "GRANT REFERENCES, TRIGGER, TRUNCATE",
  "authenticated connector grants were not repaired",
  "Phase 1G authenticated-grant repair rehearsal passed",
]) requireText("grantRehearsal", text);

for (const text of ["Phase 1G", "messaging/outbox lineage"]) {
  requireText("roadmap", text);
}
requireText("workflow", "check:klamath-phase-1g");
requireText("workflow", "BLULADDER_KLAMATH_PHASE1G_DATABASE_URL");
requireText("workflow", "BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL");

const exactArtifacts = {
  migration: {
    bytes: 12048,
    sha256: "5c11e0263527ffa996e2e4f18498b89773f5398933ff68dadbc43bbff2f599d0",
  },
  preflight: {
    bytes: 5119,
    sha256: "dda9edf3ba5a9bf0e75029a68cd15366ebe09cb7032fb25061a9afcec4ea5806",
  },
  verification: {
    bytes: 3030,
    sha256: "d6bca7c374bbd9da99b3a5ae2ddca53d3196fd47f5012f9e3ac99c6a9bdf792d",
  },
  rehearsal: {
    bytes: 8452,
    sha256: "7349da023cb4edf0709d452906150b30e84929146623e1e50dfe78df977e4f72",
  },
  grantMigration: {
    bytes: 7532,
    sha256: "5d6ecf9f46217c4a4905415f2e5031f9c30dfaa5c0eb41a8634d6fb21c2ae44a",
  },
  grantPreflight: {
    bytes: 2217,
    sha256: "6a23f29576b6d1d3465a7599e64329cf7f89b9297dd276f42d8708e229a45477",
  },
  grantVerification: {
    bytes: 1994,
    sha256: "5390dccec64113cbf18bb7c90c733c221c333234573523c60937707964c735b6",
  },
  grantRehearsal: {
    bytes: 2234,
    sha256: "a270d07607deda03b823bd500e7493733910dc5c7dc9314e23de737556654aac",
  },
};
for (const [key, expected] of Object.entries(exactArtifacts)) {
  const bytes = fs.readFileSync(path.join(root, relative[key]));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== expected.bytes || sha256 !== expected.sha256) {
    errors.push(`${relative[key]} exact artifact drifted`);
  }
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1G gate JSON is invalid: ${error.message}`);
}
if (register) {
  if (
    register.phase !== "1G" ||
    register.status !== "hosted_schema_applied_grant_repair_candidate" ||
    register.prepared_from_main !==
      "8bc3caa347ea7bad3cc9a571b732d6c19be24912" ||
    register.messaging_connector_contract_prepared !== true ||
    register.additive_migration_prepared !== true ||
    register.hosted_preflight_passed !== true ||
    register.hosted_preflight_sms_message_count !== 134 ||
    register.hosted_preflight_parented_count !== 28 ||
    register.hosted_preflight_unparented_count !== 106 ||
    register.hosted_preflight_parent_conflict_count !== 0 ||
    register.hosted_preflight_non_dfw_parent_count !== 0 ||
    register.hosted_schema_applied !== true ||
    register.hosted_execution_version !== "20260814071137" ||
    register.hosted_ledger_count !== 158 ||
    register.hosted_data_lineage_postflight_passed !== true ||
    register.authenticated_grants_exact !== false ||
    JSON.stringify(register.authenticated_excess_privileges) !==
      JSON.stringify(["REFERENCES", "TRIGGER", "TRUNCATE"]) ||
    register.authenticated_grant_repair_prepared !== true ||
    register.messaging_runtime_deployed !== false ||
    register.dfw_provider_changed !== false ||
    register.klamath_connector_count !== 0 ||
    register.activation_allowed !== false ||
    register.customer_traffic_allowed !== false ||
    register.messages_authorized !== false ||
    Object.values(register.authorized_actions ?? {}).some(Boolean)
  ) errors.push("Phase 1G repository contract drifted");

  const gates = register.gates ?? [];
  if (gates.length !== 9 || new Set(gates.map((gate) => gate.id)).size !== 9) {
    errors.push("Phase 1G gate identity/count drifted");
  }
  for (const gate of gates) {
    const expected = [
      "phase_1g_connector_contract",
      "hosted_messaging_preflight",
    ].includes(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) errors.push(`gate ${gate.id} must be ${expected}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1G gate OK: additive lineage is hosted and verified; exact least-privilege repair is prepared while runtime, providers, messages, and activation remain blocked.",
);
