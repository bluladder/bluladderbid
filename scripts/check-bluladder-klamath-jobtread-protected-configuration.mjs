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
  status: "protected_bindings_resolved_credential_unconfigured",
  provider_account_uniquely_matched: true,
  grant_created: true,
  grant_configured: false,
  grant_verified: false,
  custom_fields_created: true,
  api_explorer_session_read_verified: true,
  api_explorer_session_read_used_grant: false,
  api_explorer_custom_field_count: 24,
  exact_protected_bindings_resolved: true,
  protected_binding_count: 5,
  protected_bindings_unique: true,
  bounded_read_runtime_repository_adopted: true,
  protected_values_stored_in_repository: false,
  protected_values_stored_in_hosted_secret: false,
  webhook_created: false,
  connector_row_created: false,
  runtime_provider_calls_performed: false,
  provider_resources_mutated: true,
  hosted_mutation_performed: false,
  deployment_performed: false,
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
    "deployment and traffic disabled",
    "controlled security boundary stopped transmission",
    "24 custom fields",
    "five exact bindings",
    "did not use the new Grant",
    "lowercase SHA-256",
    "imported only by the repository-adopted Klamath admin/service",
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
  "Klamath JobTread protected configuration OK: exact secret-safe resolvers are reachable only through the inactive bounded read runtime; deployment and traffic remain disabled.",
);
