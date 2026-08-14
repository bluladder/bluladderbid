import fs from "node:fs";
import path from "node:path";
import process from "node:process";
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
  "repository contract; hosted and runtime changes blocked",
  "Recipient identity, caller ID, browser input, message content",
  "Failure never falls back to DFW",
  "Platform/legal safety suppressions remain global",
  "No schema application may create an active Klamath connector",
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

for (const text of ["Phase 1G", "messaging/outbox lineage"]) {
  requireText("roadmap", text);
}
requireText("workflow", "check:klamath-phase-1g");

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1G gate JSON is invalid: ${error.message}`);
}
if (register) {
  if (
    register.phase !== "1G" ||
    register.status !== "repository_contract_only" ||
    register.prepared_from_main !==
      "0148b95da3a5c878557d788d4486e9a39d5bdc42" ||
    register.messaging_connector_contract_prepared !== true ||
    register.hosted_schema_applied !== false ||
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
    const expected = gate.id === "phase_1g_connector_contract"
      ? "ready"
      : "blocked";
    if (gate.status !== expected) errors.push(`gate ${gate.id} must be ${expected}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1G gate OK: connector selection is organization-bound and fail closed; hosted schema, providers, messages, and activation remain blocked.",
);
