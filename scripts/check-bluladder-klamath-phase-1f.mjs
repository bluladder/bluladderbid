import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1f-portal-tenant-lineage.md",
  register: "docs/operations/bluladder-klamath-phase-1f-gates.json",
  migration:
    "supabase/migrations/20260814060000_bluladder_klamath_phase_1f_portal_tenant_lineage.sql",
  preflight:
    "supabase/preflight/bluladder_klamath_phase_1f_portal_tenant_lineage.sql",
  postflight:
    "supabase/verification/bluladder_klamath_phase_1f_portal_tenant_lineage.sql",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-phase-1f-portal-lineage-postgres.sh",
  authority: "supabase/functions/_shared/portalOrganizationAuthority.ts",
  authorityTests:
    "supabase/functions/_shared/portalOrganizationAuthority_test.ts",
  sessions: "supabase/functions/_shared/customerVerification.ts",
  otpRequest: "supabase/functions/customer-verification-request/index.ts",
  otpConfirm: "supabase/functions/customer-verification-confirm/index.ts",
  authLink: "supabase/functions/customer-auth-link/index.ts",
  portal: "supabase/functions/customer-portal-data/index.ts",
  authedPortal: "supabase/functions/customer-portal-data-authed/index.ts",
  preferences: "supabase/functions/manage-sms-optout/index.ts",
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
  if (!content[key]?.includes(text)) {
    errors.push(`${relative[key]} omits: ${text}`);
  }
}

for (
  const text of [
    "repository-only, fail-closed migration and runtime candidate",
    "server normalizes",
    "exact canonical DFW hostname",
    "never a missing-authority or first-row fallback",
    "Klamath activation remains blocked",
  ]
) requireText("contract", text);

for (
  const text of [
    "LOCK TABLE",
    "customer account parent organization reconciliation required",
    "organization-scoped customer email reconciliation required",
    "Klamath customer traffic must remain absent",
    "customer_accounts_organization_customer_fkey",
    "customer_portal_sessions_organization_account_fkey",
    "customers_organization_email_key",
    "customer_accounts_organization_verified_phone_key",
    "customer_accounts_organization_verified_email_key",
    "customer_accounts_organization_auth_user_key",
    "enforce_customer_account_organization_lineage",
    "enforce_portal_session_organization_lineage",
    "Tenant members view customer accounts",
    "Tenant members view portal sessions",
  ]
) requireText("migration", text);

for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "non_dfw_legacy_account_count",
    "klamath_customer_count",
    "challenge_count",
  ]
) requireText("preflight", text);
for (
  const text of [
    "BEGIN TRANSACTION READ ONLY",
    "account_lineage_mismatch_count",
    "session_lineage_mismatch_count",
    "retired_global_account_identity_key_count",
    "provisioning_organization_count",
  ]
) requireText("postflight", text);
for (
  const text of [
    "BLULADDER_KLAMATH_PHASE1F_DATABASE_URL",
    "trigger-derived Klamath lineage failed",
    "mismatched account lineage was accepted",
    "Phase 1F disposable PostgreSQL rehearsal passed",
  ]
) requireText("rehearsal", text);

for (
  const text of [
    "normalizePortalOrigin",
    'url.protocol !== "https:"',
    'source: "exact_dfw_compatibility"',
    '.from("organization_customer_sites")',
    'site.mapping_status !== "active"',
    "site.runtime_routing_enabled !== true",
    "site.site_published !== true",
    "site.customer_traffic_allowed !== true",
    'organizations[0]?.status !== "active"',
  ]
) requireText("authority", text);
for (
  const text of [
    "rejects missing, insecure, credentialed, and preview origins",
    "provisioning Klamath site remains blocked",
    "active exact site and active organization resolve",
    "fail closed",
  ]
) requireText("authorityTests", text);

for (
  const key of [
    "otpRequest",
    "otpConfirm",
    "authLink",
    "authedPortal",
    "preferences",
  ]
) requireText(key, "resolvePortalOrganizationAuthority");
for (
  const key of ["otpRequest", "otpConfirm", "authLink"]
) requireText(key, "organization_id");
for (
  const key of ["portal", "authedPortal"]
) {
  requireText(key, '.eq("organization_id"');
  requireText(key, "DFW_ORGANIZATION_ID");
}
for (
  const text of [
    "organization_id, customer_account_id",
    '.eq("organization_id", data.organization_id)',
  ]
) requireText("sessions", text);

requireText("workflow", "Phase 1F portal tenant lineage");
for (
  const text of [
    "Klamath Phase 1F",
    "portal tenant lineage",
    "migration remains unapplied",
  ]
) requireText("roadmap", text);

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1F gate JSON is invalid: ${error.message}`);
}
if (register) {
  if (
    register.phase !== "1F" ||
    register.prepared_from_main !==
      "da7ddaa5b42e333acf6175c14aa99487d02a421f" ||
    register.canonical_migration_version !== "20260814060000" ||
    register.canonical_migration_applied !== false ||
    register.portal_runtime_deployed !== false ||
    register.frontend_published !== false ||
    register.account_lineage_contract_prepared !== true ||
    register.session_lineage_contract_prepared !== true ||
    register.portal_site_authority_contract_prepared !== true ||
    register.organization_scoped_portal_reads_prepared !== true ||
    register.global_session_hash_preserved !== true ||
    register.dfw_exact_compatibility_preserved !== true
  ) errors.push("Phase 1F repository contract drifted");

  for (
    const key of [
      "activation_allowed",
      "customer_traffic_allowed",
      "runtime_routing_enabled",
      "site_published",
    ]
  ) {
    if (register[key] !== false) errors.push(`${key} must remain false`);
  }
  if (
    register.klamath_lifecycle !== "provisioning" ||
    register.provider_identity_count !== 0 ||
    Object.values(register.authorized_actions ?? {}).some(Boolean)
  ) errors.push("Phase 1F authorizes a protected or active state");

  const ready = new Set([
    "hosted_organization_identity",
    "phase_1f_repository_contract",
    "portal_site_authority",
  ]);
  const gates = register.gates ?? [];
  if (
    gates.length !== 14 || new Set(gates.map((gate) => gate.id)).size !== 14
  ) errors.push("Phase 1F gate identity/count drifted");
  for (const gate of gates) {
    const expected = ready.has(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) {
      errors.push(`gate ${gate.id} must be ${expected}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1F gate OK: portal identity and reads have exact tenant-lineage contracts while hosted schema, deployment, providers, and activation remain blocked.",
);
