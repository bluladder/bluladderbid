import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  preflight:
    "supabase/preflight/bluladder_klamath_compliance_site_activation.sql",
  postflight:
    "supabase/verification/bluladder_klamath_compliance_site_activation.sql",
  contract:
    "docs/architecture/bluladder-klamath-compliance-site-activation.md",
  gates:
    "docs/operations/bluladder-klamath-compliance-site-activation-gates.json",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
};

const content = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(absolute, "utf8");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) errors.push(`${files[key]} omits: ${text}`);
}

const forbiddenSql = /\b(?:insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|merge\s+into|create\s+(?:table|index|policy)|alter\s+table|drop\s+(?:table|index|policy)|truncate|grant|revoke|call)\b/i;
for (const key of ["preflight", "postflight"]) {
  for (const text of [
    "BEGIN TRANSACTION READ ONLY;",
    "SET LOCAL statement_timeout = '15s';",
    "SET LOCAL lock_timeout = '3s';",
    "ROLLBACK;",
    "customer_traffic_allowed = false",
    "status = 'disabled'",
    "status = 'inactive'",
    "runtime_enabled = false",
    "webhook_enabled = false",
    "active_messaging_connector_count",
    "published_phone_contact_count",
    "published_sms_contact_count",
    "distinct_public_destination_count",
    "complete_public_contact_evidence_count",
    "exact_dfw_default_count",
    "unexpected_legacy_default_count",
  ]) requireText(key, text);
  if (forbiddenSql.test(content[key] ?? "")) {
    errors.push(`${files[key]} contains a forbidden mutation`);
  }
}

for (const text of [
  "exact_klamath_provisioning_count",
  "exact_inactive_site_count",
  "public_contact_count",
  "membership_count",
  "internal_contact_count",
  "inactive_territory_count",
  "inactive_manual_service_count",
  "draft_disabled_pricing_count",
  "inactive_jobtread_connector_count",
]) requireText("preflight", text);
for (const text of [
  "exact_klamath_active_count",
  "exact_compliance_only_site_count",
  "public_contact_count",
  "membership_count",
  "internal_contact_count",
  "inactive_territory_count",
  "inactive_manual_service_count",
  "draft_disabled_pricing_count",
  "inactive_jobtread_connector_count",
]) requireText("postflight", text);

for (const text of [
  "does not contain a migration",
  "customer_traffic_allowed` remains false",
  "generic hostname resolution key remains disabled",
  "separate approval",
  "qualified legal review",
  "public contacts",
  "custom domain, DNS, and TLS",
  "frontend",
  "Klamath-specific messaging campaign",
]) requireText("contract", text);

let gates;
try {
  gates = JSON.parse(content.gates ?? "{}");
} catch (error) {
  errors.push(`gate JSON is invalid: ${error.message}`);
}
if (gates) {
  if (
    gates.schema_version !== 1 ||
    gates.tenant_key !== "bluladder-klamath" ||
    gates.prepared_from_main !== "7cd37ae0bdcbe319659412bcfc098e7293524bb8" ||
    gates.repository_preflight_ready !== true ||
    gates.repository_postflight_ready !== true ||
    gates.activation_migration_prepared !== false ||
    gates.customer_traffic_allowed !== false ||
    gates.provider_runtime_allowed !== false ||
    gates.activation_allowed !== false
  ) errors.push("compliance-site gate identity or fail-closed state drifted");

  for (const [key, expected] of Object.entries({
    exact_dfw_default_count: 1,
    unexpected_legacy_default_count: 0,
    exact_klamath_provisioning_count: 1,
    exact_inactive_site_count: 1,
    exact_disabled_hostname_count: 1,
    unexpected_resolution_key_count: 0,
    public_contact_count: 2,
    published_public_contact_count: 2,
    published_phone_contact_count: 1,
    published_sms_contact_count: 1,
    distinct_public_destination_count: 2,
    complete_public_contact_evidence_count: 2,
    membership_count: 0,
    internal_contact_count: 0,
    inactive_territory_count: 2,
    territory_count: 2,
    active_territory_count: 0,
    inactive_manual_service_count: 6,
    service_count: 6,
    active_service_count: 0,
    draft_disabled_pricing_count: 1,
    pricing_profile_count: 1,
    runtime_pricing_count: 0,
    inactive_jobtread_connector_count: 1,
    crm_connector_count: 1,
    active_crm_connector_count: 0,
    active_messaging_connector_count: 0,
    messaging_connector_count: 0,
  })) {
    if (gates.required_preflight_counts?.[key] !== expected) {
      errors.push(`preflight expectation drifted: ${key}`);
    }
  }
  for (const value of Object.values(gates.authorized_actions ?? {})) {
    if (value !== false) errors.push("gate file authorizes a production action");
  }
}

requireText("package", '"check:klamath-compliance-site-activation"');
requireText("ci", "bun run check:klamath-compliance-site-activation");

if (errors.length) {
  console.error("Klamath compliance-site activation contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath compliance-site activation contract passed (read-only gates only; no production action authorized).",
);
