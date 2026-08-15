import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  implementation:
    "supabase/functions/_shared/jobtreadKlamathProtectedConfiguration.ts",
  tests:
    "supabase/functions/_shared/jobtreadKlamathProtectedConfiguration_test.ts",
  contract:
    "docs/architecture/bluladder-klamath-jobtread-protected-configuration.md",
  evidence:
    "docs/operations/bluladder-klamath-jobtread-protected-configuration-gates.json",
  composition: "supabase/functions/_shared/jobtreadExecutionComposition.ts",
};
const contents = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[key] = fs.readFileSync(full, "utf8");
}

let evidence;
try {
  evidence = JSON.parse(contents.evidence ?? "{}");
} catch (error) {
  errors.push(`invalid protected-configuration evidence: ${error.message}`);
}
const exactEvidence = {
  status: "protected_configuration_and_inactive_connector_verified",
  provider_account_uniquely_matched: true,
  grant_created: true,
  grant_configured: true,
  grant_verified: true,
  custom_fields_created: true,
  api_explorer_session_read_verified: true,
  api_explorer_session_read_used_grant: true,
  api_explorer_custom_field_count: 24,
  exact_protected_bindings_resolved: true,
  protected_binding_count: 5,
  protected_bindings_unique: true,
  bounded_read_runtime_repository_adopted: true,
  protected_values_stored_in_repository: false,
  protected_values_stored_in_hosted_secret: true,
  hosted_secret_presence_count: 7,
  hosted_secret_values_inspected: false,
  webhook_created: false,
  connector_row_created: true,
  connector_exact_inactive_count: 1,
  connector_activation_surface_count: 0,
  connector_webhook_reference_count: 0,
  runtime_flag_present: false,
  runtime_provider_calls_performed: false,
  provider_resources_mutated: true,
  hosted_mutation_performed: true,
  deployment_performed: true,
  activation_allowed: false,
  customer_traffic_allowed: false,
  dfw_fallback_allowed: false,
};
for (const [key, value] of Object.entries(exactEvidence)) {
  if (evidence?.[key] !== value) errors.push(`evidence ${key} drifted`);
}

for (
  const phrase of [
    "bluladder-klamath-jobtread-production-v1",
    "JOBTREAD_KLAMATH_GRANT_KEY",
    "JOBTREAD_KLAMATH_PROVIDER_ORGANIZATION_ID",
    "JOBTREAD_KLAMATH_CUSTOMER_REFERENCE_FIELD_ID",
    "JOBTREAD_KLAMATH_CONTACT_PHONE_FIELD_ID",
    "JOBTREAD_KLAMATH_CONTACT_EMAIL_FIELD_ID",
    "JOBTREAD_KLAMATH_LOCATION_REFERENCE_FIELD_ID",
    "JOBTREAD_KLAMATH_BOOKING_REFERENCE_FIELD_ID",
    "BluLadder Customer Reference",
    "BluLadder Location Reference",
    "BluLadder Booking Reference",
    "providerOrganizationFingerprint",
    "new Set(Object.values(normalizedBindings)).size !== 5",
  ]
) {
  if (!contents.implementation?.includes(phrase)) {
    errors.push(`protected configuration omits ${phrase}`);
  }
}
for (
  const phrase of [
    "exact non-secret configuration",
    "another organization or reference",
    "missing, duplicate, or malformed authority",
    "preserves exact secret and rejects unsafe forms",
    "custom-field contract is exact and non-sensitive",
  ]
) {
  if (!contents.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (
  const phrase of [
    "deployed read runtime remains",
    "protected hosted secret boundary",
    "24 custom fields",
    "All five bindings matched",
    "Grant-authenticated Pave read",
    "lowercase SHA-256",
    "inactive, runtime-disabled",
  ]
) {
  if (!contents.contract?.includes(phrase)) {
    errors.push(`contract omits ${phrase}`);
  }
}
if (
  !contents.composition?.includes(
    "No production Edge entry point imports this factory",
  )
) {
  errors.push("dormant execution boundary drifted");
}
if (
  /Deno\.env\.get\(["']JOBTREAD_KLAMATH_GRANT_KEY["']\)/.test(
    contents.implementation ?? "",
  )
) {
  errors.push(
    "implementation bypasses the injected protected environment reader",
  );
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread protected configuration OK: exact hosted secrets and inactive connector are verified; the deployed read runtime remains dual-gated and traffic-disabled.",
);
