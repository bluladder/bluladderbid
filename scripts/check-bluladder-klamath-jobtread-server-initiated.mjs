import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-jobtread-server-initiated-first-wave.md",
  register:
    "docs/operations/bluladder-klamath-jobtread-server-initiated-gates.json",
  policy:
    "supabase/functions/_shared/jobtreadFirstWaveInboundPolicy.ts",
  tests:
    "supabase/functions/_shared/jobtreadFirstWaveInboundPolicy_test.ts",
  receipts:
    "supabase/functions/_shared/jobtreadPhase1IWebhookReceipts.ts",
  launchInputs:
    "packages/tenant-config/bluladderKlamathLaunchInputs.ts",
  launchTemplate:
    "docs/operations/bluladder-klamath-launch-inputs.template.json",
};
const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

let register;
let launchTemplate;
try {
  register = JSON.parse(content.register ?? "{}");
  launchTemplate = JSON.parse(content.launchTemplate ?? "{}");
} catch (error) {
  errors.push(`invalid JSON contract: ${error.message}`);
}

const exact = {
  mode: "server_initiated_only",
  webhook_enabled: false,
  webhook_secret_reference_present: false,
  public_webhook_route_enabled: false,
  provider_payload_accepted: false,
  provider_event_authority_accepted: false,
  live_availability_read_required: true,
  provider_initiated_changes: "operator_dual_entry_manual_review",
  operation_attempt_mode: "hashed_single_attempt",
  mutation_auto_retry_allowed: false,
  ambiguous_mutation_requires_reconciliation: true,
  future_authenticated_receipt_store_preserved: true,
  grant_created: false,
  custom_fields_created: false,
  connector_row_created: false,
  runtime_entrypoint_adopted: false,
  deployment_performed: false,
  provider_calls_performed: false,
  hosted_mutation_performed: false,
  activation_allowed: false,
  customer_traffic_allowed: false,
  dfw_fallback_allowed: false,
};
for (const [key, value] of Object.entries(exact)) {
  if (register?.[key] !== value) errors.push(`register ${key} drifted`);
}
for (const phrase of [
  "server_initiated_only",
  "webhook_not_disabled",
  "provider_payload_accepted",
  "mutation_auto_retry_allowed",
  "ready_for_separate_runtime_review",
  "activationAllowed: false",
]) {
  if (!content.policy?.includes(phrase)) errors.push(`policy omits ${phrase}`);
}
for (const phrase of [
  "enabled webhook and public route fail closed",
  "provider payload and event authority are never accepted",
  "mutation retry and uncertain-outcome weakening fail closed",
  "secret/provider fields and unrelated extras are rejected",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  "does not create or consume a JobTread webhook",
  "operator must apply the corresponding",
  "Live availability reads remain mandatory",
  "activation review remain separate gates",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
if (!content.receipts?.includes("sourceAuthenticated: true")) {
  errors.push("future webhook receipt store no longer requires auth proof");
}
for (const key of [
  "jobtread_server_initiated_mode_verified",
  "jobtread_webhook_disabled_verified",
]) {
  if (!content.launchInputs?.includes(key)) {
    errors.push(`launch input contract omits ${key}`);
  }
  if (launchTemplate?.providerReadiness?.[key] !== false) {
    errors.push(`launch template ${key} must remain false`);
  }
}
for (const removed of [
  "jobtread_webhook_authentication_verified",
  "jobtread_webhook_configured",
]) {
  if (
    content.launchInputs?.includes(removed) ||
    Object.prototype.hasOwnProperty.call(
      launchTemplate?.providerReadiness ?? {},
      removed,
    )
  ) errors.push(`obsolete first-wave launch gate remains: ${removed}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread first-wave ingress OK: server initiated, webhook absent, unsigned provider payload has no authority.",
);
