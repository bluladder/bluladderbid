import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1e-hosted-identity-reconciliation.md",
  register: "docs/operations/bluladder-klamath-phase-1e-gates.json",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
  tests: "packages/tenant-config/bluladderKlamath.test.ts",
  authority: "packages/tenant-config/siteAuthority.ts",
  phase1c: "docs/operations/bluladder-klamath-phase-1c-gates.json",
  phase1d: "docs/operations/bluladder-klamath-phase-1d-gates.json",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
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
    "repository-only, inactive identity reconciliation",
    "the exact reviewed Klamath organization UUID",
    "site mapping status `provisioning`",
    "still returns",
    "DFW fallback remains prohibited",
    "Remaining launch gates",
  ]
) requireText("contract", text);

for (
  const text of [
    "export const BLULADDER_KLAMATH_ORGANIZATION_ID",
    '"b1addf00-0000-4000-8000-000000000003"',
    "organizationId: BLULADDER_KLAMATH_ORGANIZATION_ID",
    'lifecycle: "provisioning"',
    'mappingStatus: "provisioning"',
    "runtimeRoutingEnabled: false",
    "published: false",
    "activationAllowed: false",
    "customerTrafficAllowed: false",
    "dfwFallbackAllowed: false",
    "numberProvisioned: false",
    "runtimeEnabled: false",
  ]
) requireText("tenant", text);

for (
  const text of [
    "BLULADDER_KLAMATH_ORGANIZATION_ID",
    "blocks the current provisioning Klamath mapping",
    'code: "site_mapping_unavailable"',
  ]
) requireText("tests", text);
for (
  const text of [
  "server-supplied site records",
    'code: "site_mapping_unavailable"',
    'code: "organization_inactive"',
    'code: "runtime_routing_disabled"',
  ]
) requireText("authority", text);

let register;
let phase1c;
let phase1d;
try {
  register = JSON.parse(content.register ?? "{}");
  phase1c = JSON.parse(content.phase1c ?? "{}");
  phase1d = JSON.parse(content.phase1d ?? "{}");
} catch (error) {
  errors.push(`Klamath gate JSON is invalid: ${error.message}`);
}

if (register) {
  if (
    register.phase !== "1E" ||
    register.prepared_from_main !==
      "d1c2cd4f2fa1760d4ad353836f3eb07495f647b7" ||
    register.hosted_foundation_execution_version !== "20260814050336" ||
    register.phase_1d_build_marker !==
      "voice-realtime-link-mvp.8-tenant-site-runtime" ||
    register.hosted_organization_provisioned !== true ||
    register.repository_organization_identity_reconciled !== true ||
    register.repository_site_mapping_status !== "provisioning" ||
    register.phase_1d_runtime_deployed !== true ||
    register.webhook_auth_boundary_verified !== true
  ) errors.push("Phase 1E repository/hosted identity drifted");

  for (
    const key of [
      "activation_allowed",
      "customer_traffic_allowed",
      "runtime_routing_enabled",
      "site_published",
      "hostname_resolution_key_enabled",
      "dfw_fallback_allowed",
    ]
  ) {
    if (register[key] !== false) errors.push(`${key} must remain false`);
  }
  if (
    register.lifecycle !== "provisioning" ||
    register.provider_identity_count !== 0 ||
    register.membership_count !== 0 ||
    register.contact_count !== 0
  ) errors.push("Phase 1E inactive/empty hosted boundary drifted");
  if (Object.values(register.authorized_actions ?? {}).some(Boolean)) {
    errors.push("Phase 1E authorizes a protected action");
  }

  const ready = new Set([
    "hosted_organization_identity",
    "repository_identity_reconciliation",
    "provisioning_site_fail_closed",
    "phase_1d_runtime_deployment",
    "webhook_authentication_boundary",
  ]);
  const gates = register.gates ?? [];
  if (
    gates.length !== 14 || new Set(gates.map((gate) => gate.id)).size !== 14
  ) {
    errors.push("Phase 1E gate identity/count drifted");
  }
  for (const gate of gates) {
    const expected = ready.has(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) {
      errors.push(`gate ${gate.id} must be ${expected}`);
    }
  }
}

if (
  !phase1c?.migration_applied ||
  !phase1c?.hosted_organization_provisioned ||
  phase1c?.activation_allowed !== false ||
  phase1c?.customer_traffic_allowed !== false ||
  phase1d?.database_backed_site_loader !== true ||
  phase1d?.activation_allowed !== false
) errors.push("Phase 1C/1D prerequisite evidence drifted");

for (
  const text of [
    "Klamath Phase 1E",
    "hosted provisioning identity",
    "activation remains blocked",
  ]
) requireText("roadmap", text);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1E gate OK: the typed tenant profile matches the verified hosted provisioning identity while every activation surface remains blocked.",
);
