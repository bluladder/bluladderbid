import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  runtime: "supabase/functions/_shared/jobtreadKlamathReadRuntime.ts",
  handler: "supabase/functions/jobtread-klamath-read-runtime/handler.ts",
  index: "supabase/functions/jobtread-klamath-read-runtime/index.ts",
  runtimeTests: "supabase/functions/_shared/jobtreadKlamathReadRuntime_test.ts",
  handlerTests:
    "supabase/functions/jobtread-klamath-read-runtime/handler_test.ts",
  contract: "docs/architecture/bluladder-klamath-jobtread-read-runtime.md",
  register:
    "docs/operations/bluladder-klamath-jobtread-read-runtime-gates.json",
  config: "supabase/config.toml",
};
const content = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`invalid gate register: ${error.message}`);
}
const exact = {
  compiled_organization_authority: true,
  request_organization_selectable: false,
  admin_or_internal_service_only: true,
  runtime_flag_required: true,
  runtime_flag_enabled: false,
  active_runtime_connector_required: true,
  connector_active: false,
  connector_runtime_enabled: false,
  provider_mutation_allowed: false,
  raw_provider_response_returned: false,
  credential_or_provider_identifier_returned: false,
  request_context_persisted: false,
  jobtread_webhook_present: false,
  dfw_fallback_allowed: false,
  jobber_fallback_allowed: false,
  deployment_performed: false,
  provider_request_performed_by_release: false,
  hosted_mutation_performed_by_release: false,
  customer_traffic_allowed: false,
  activation_allowed: false,
};
for (const [key, value] of Object.entries(exact)) {
  if (register?.[key] !== value) errors.push(`register ${key} drifted`);
}
if (
  JSON.stringify(register?.approved_capabilities) !==
    JSON.stringify(["health", "availability_read"])
) errors.push("approved capability set drifted");
if (
  JSON.stringify(register?.blocked_capabilities) !== JSON.stringify([
    "customer_sync",
    "quote_sync",
    "booking_create",
    "booking_update",
    "booking_cancel",
    "invoice_handoff",
    "communications_handoff",
  ])
) errors.push("blocked capability set drifted");

for (
  const phrase of [
    "KLAMATH_JOBTREAD_READ_RUNTIME_FLAG",
    "createJobTreadReadPlanSource",
    "createJobTreadExecutionRunner",
    "createJobTreadPhase1IStores",
    "createKlamathJobTreadProtectedResolvers",
    "if (input.mutation)",
    "MAX_AVAILABILITY_WINDOW_DAYS = 31",
  ]
) {
  if (!content.runtime?.includes(phrase)) {
    errors.push(`runtime omits ${phrase}`);
  }
}
for (const phrase of ["readBoundedJson", "MAX_BODY_BYTES = 4_096"]) {
  if (!content.handler?.includes(phrase)) {
    errors.push(`handler omits ${phrase}`);
  }
}
for (
  const phrase of [
    "requireAdminOrService",
    '"operations_admin"',
    "createProductionKlamathJobTreadReadRuntime",
  ]
) {
  if (!content.index?.includes(phrase)) errors.push(`index omits ${phrase}`);
}
for (
  const forbidden of [
    "customer_sync",
    "booking_create",
    "booking_update",
    "idempotencyKey",
  ]
) {
  if (content.handler?.includes(forbidden)) {
    errors.push(`handler unexpectedly contains ${forbidden}`);
  }
}
for (
  const phrase of [
    "dedicated flag blocks before every protected dependency",
    "read-only transport rejects mutations without fetch",
    "synthetic health reaches transport once",
    "fingerprint mismatch stops before credential and transport",
  ]
) {
  if (!content.runtimeTests?.includes(phrase)) {
    errors.push(`runtime tests omit ${phrase}`);
  }
}
for (
  const phrase of [
    "unauthorized calls stop before request parsing",
    "handler returns only sanitized health evidence",
    "handler rejects write and extra-field requests",
    "handler enforces the byte cap without trusting content-length",
  ]
) {
  if (!content.handlerTests?.includes(phrase)) {
    errors.push(`handler tests omit ${phrase}`);
  }
}
for (
  const phrase of [
    "Two independent runtime stops",
    "cannot construct or transmit a mutation",
    "No function is deployed",
    "DFW and Jobber fallback remain prohibited",
  ]
) {
  if (!content.contract?.includes(phrase)) {
    errors.push(`contract omits ${phrase}`);
  }
}
if (
  !content.config?.includes(
    "[functions.jobtread-klamath-read-runtime]\nverify_jwt = false",
  )
) errors.push("function auth configuration missing");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread read runtime OK: admin/service-only, dual-gated, read-only, undeployed, and inactive.",
);
