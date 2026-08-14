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
  outbox: "supabase/functions/_shared/smsOutbox.ts",
  twilio: "supabase/functions/_shared/twilioSms.ts",
  twilioTests: "supabase/functions/_shared/twilioSms_test.ts",
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
  grantReceipt:
    "supabase/migrations/20260814072713_83b1f9da-ae78-4e2e-817a-09c40f2388a4.sql",
  grantPreflight:
    "supabase/preflight/bluladder_klamath_phase_1g_authenticated_grants.sql",
  grantVerification:
    "supabase/verification/bluladder_klamath_phase_1g_authenticated_grants.sql",
  grantRehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1g-authenticated-grants-postgres.sh",
  scopedMigration:
    "supabase/migrations/20260814074000_bluladder_klamath_phase_1g_scoped_sms_outbox.sql",
  scopedReceipt:
    "supabase/migrations/20260814081254_c3fdd8e6-ea9b-4220-a90b-5c1e8409be5d.sql",
  scopedPreflight:
    "supabase/preflight/bluladder_klamath_phase_1g_scoped_sms_outbox.sql",
  scopedVerification:
    "supabase/verification/bluladder_klamath_phase_1g_scoped_sms_outbox.sql",
  scopedRehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1g-scoped-sms-outbox-postgres.sh",
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
  "hosted additive schema, least-privilege repair, and scoped outbox",
  "Recipient identity, caller ID, browser input, message content",
  "Failure never falls back to DFW",
  "Platform/legal safety suppressions remain global",
  "No schema application may create an active Klamath connector",
  "134 historical messaging-ledger rows",
  "28 have a server-owned parent",
  "106 are legacy unparented rows",
  "version `20260814071137`",
  "version `20260814072713`",
  "version `20260814081254`",
  "db0c52f8e729931bc6f60270bae6e3050d4e7a33c6abcc0ecf55cb05e8b3c069",
  "`REFERENCES`, `TRIGGER`, and `TRUNCATE`",
  "Fail-closed Twilio adapter candidate",
  "dedicated API key",
  "This adapter is repository-only",
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
  "REVOKE ALL PRIVILEGES",
  "GRANT SELECT, INSERT, UPDATE, DELETE",
  "Phase 1G authenticated role retains excess access",
]) requireText("grantReceipt", text);

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

for (const text of [
  "claim_organization_sms_outbox_send",
  "connector_authority_invalid",
  "organization_lineage_mismatch",
  "GRANT EXECUTE",
  "Phase 1G scoped outbox migration changed data",
]) requireText("scopedMigration", text);

for (const text of [
  "claim_organization_sms_outbox_send",
  "connector_authority_invalid",
  "organization_lineage_mismatch",
  "GRANT EXECUTE",
  "Phase 1G scoped outbox migration changed data",
]) requireText("scopedReceipt", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY",
  "scoped_claim_count",
  "connector_bound_count",
  "klamath_provisioning_count",
  "ROLLBACK",
]) requireText("scopedPreflight", text);

for (const text of [
  "scoped_claim_count",
  "anon_execute",
  "authenticated_execute",
  "service_role_execute",
  "connector_bound_count",
]) requireText("scopedVerification", text);

for (const text of [
  "BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL",
  "scoped outbox omitted durable authority",
  "cross-connector replay did not fail closed",
  "inactive organization was allowed to claim dispatch",
]) requireText("scopedRehearsal", text);

for (const text of [
  "selectOrganizationMessagingConnector",
  "guardMessagingDispatch",
  "claim_organization_sms_outbox_send",
  "provider_adapter_unavailable",
]) requireText("outbox", text);

for (const text of [
  "bluladder-klamath-twilio-production-v1",
  "TWILIO_KLAMATH_ACCOUNT_SID",
  "TWILIO_KLAMATH_API_KEY_SID",
  "TWILIO_KLAMATH_API_KEY_SECRET",
  "MessagingServiceSid",
  "twilio_transport_uncertain",
  "provider_ambiguous",
]) requireText("twilio", text);

for (const text of [
  "resolves only the reviewed connector reference",
  "uses a Messaging Service and sanitized SMS body",
  "HTTP rejection is sanitized and terminal",
  "malformed success is delivery-ambiguous",
  "transport failure is delivery-ambiguous",
]) requireText("twilioTests", text);

for (const text of ["Phase 1G", "messaging/outbox lineage"]) {
  requireText("roadmap", text);
}
requireText("workflow", "check:klamath-phase-1g");
requireText("workflow", "BLULADDER_KLAMATH_PHASE1G_DATABASE_URL");
requireText("workflow", "BLULADDER_KLAMATH_PHASE1G_GRANTS_DATABASE_URL");
requireText("workflow", "BLULADDER_KLAMATH_PHASE1G_SCOPED_OUTBOX_DATABASE_URL");

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
  grantReceipt: {
    bytes: 7531,
    sha256: "91e3a76e0c209a2c4e157e866b1b899400bbbf6de66ca7860d8656abc8bc9070",
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
  scopedMigration: {
    bytes: 8965,
    sha256: "549578e4fdd06dff772919f15568df68a907a3e04ccc1fb0e308462cb9274fdd",
  },
  scopedReceipt: {
    bytes: 8964,
    sha256: "2efc6460a6e91ce04705d6de6a3e5cbec66068cd3e1d3b117975decff545ae88",
  },
  scopedPreflight: {
    bytes: 1420,
    sha256: "9e1e685895f320ff53c07783155a6de44c42570e755b561dc67c30c9fb83a5ef",
  },
  scopedVerification: {
    bytes: 1733,
    sha256: "1543d8e3c7c00b11d495a88fb445b050fbfb13d79b98ff7f17f17641f256c1cb",
  },
  scopedRehearsal: {
    bytes: 6165,
    sha256: "f78343cadfa03bac4698e3c265ec38876ec7eab1cde8acd90a4ce2bfac3a4bc6",
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
    register.status !== "hosted_scoped_outbox_ready_twilio_adapter_prepared" ||
    register.prepared_from_main !==
      "f5497d4a426701460c95eb2bfbe9421092e1922c" ||
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
    register.hosted_ledger_count !== 160 ||
    register.hosted_ledger_tip !== "20260814081254" ||
    register.hosted_ledger_fingerprint_sha256 !==
      "db0c52f8e729931bc6f60270bae6e3050d4e7a33c6abcc0ecf55cb05e8b3c069" ||
    register.hosted_data_lineage_postflight_passed !== true ||
    register.authenticated_grants_exact !== true ||
    JSON.stringify(register.authenticated_excess_privileges) !==
      JSON.stringify([]) ||
    register.authenticated_grant_repair_prepared !== true ||
    register.authenticated_grant_repair_applied !== true ||
    register.authenticated_grant_repair_execution_version !== "20260814072713" ||
    register.authenticated_grant_repair_payload_bytes !== 7531 ||
    register.authenticated_grant_repair_payload_sha256 !==
      "91e3a76e0c209a2c4e157e866b1b899400bbbf6de66ca7860d8656abc8bc9070" ||
    register.scoped_outbox_migration_prepared !== true ||
    register.scoped_outbox_runtime_prepared !== true ||
    register.scoped_outbox_hosted_applied !== true ||
    register.scoped_outbox_execution_version !== "20260814081254" ||
    register.scoped_outbox_payload_bytes !== 8964 ||
    register.scoped_outbox_payload_sha256 !==
      "2efc6460a6e91ce04705d6de6a3e5cbec66068cd3e1d3b117975decff545ae88" ||
    register.scoped_outbox_postflight_passed !== true ||
    register.scoped_outbox_runtime_deployed !== false ||
    register.twilio_adapter_prepared !== true ||
    register.twilio_adapter_deployed !== false ||
    register.twilio_credentials_present !== false ||
    register.twilio_sender_present !== false ||
    register.messaging_runtime_deployed !== false ||
    register.dfw_provider_changed !== false ||
    register.klamath_connector_count !== 0 ||
    register.activation_allowed !== false ||
    register.customer_traffic_allowed !== false ||
    register.messages_authorized !== false ||
    Object.values(register.authorized_actions ?? {}).some(Boolean)
  ) errors.push("Phase 1G repository contract drifted");

  const gates = register.gates ?? [];
  if (gates.length !== 10 || new Set(gates.map((gate) => gate.id)).size !== 10) {
    errors.push("Phase 1G gate identity/count drifted");
  }
  for (const gate of gates) {
    const expected = [
      "phase_1g_connector_contract",
      "hosted_messaging_preflight",
      "messaging_lineage_schema",
      "organization_scoped_outbox",
      "twilio_adapter",
    ].includes(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) errors.push(`gate ${gate.id} must be ${expected}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1G gate OK: additive lineage, exact least-privilege repair, and scoped transactional outbox are hosted and verified while remaining writer adoption, runtime, providers, messages, and activation remain blocked.",
);
