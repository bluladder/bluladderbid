import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1a-contract.md",
  register: "docs/operations/bluladder-klamath-phase-1a-gates.json",
  types: "packages/tenant-config/contracts.ts",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
  pricing: "packages/tenant-config/bluladderKlamathPricingDraft.ts",
  authority: "packages/tenant-config/siteAuthority.ts",
  tests: "packages/tenant-config/bluladderKlamath.test.ts",
};

const errors = [];
const content = {};
for (const [key, file] of Object.entries(relative)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) errors.push(`missing ${file}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

const requireText = (key, text) => {
  if (!content[key]?.includes(text)) {
    errors.push(`${relative[key]} omits: ${text}`);
  }
};

for (const text of [
  "repository-only, inactive configuration",
  "server-supplied mapping records",
  "Independent business configuration",
  "Independent pricing draft",
  "Remaining release gates",
]) requireText("contract", text);

for (const text of [
  'customerFacingName: "BluLadder Klamath"',
  "organizationId: BLULADDER_KLAMATH_ORGANIZATION_ID",
  'lifecycle: "provisioning"',
  'activationAllowed: false',
  'customerTrafficAllowed: false',
  'dfwFallbackAllowed: false',
  'canonicalHostname: BLULADDER_KLAMATH_CANONICAL_HOSTNAME',
  'mappingStatus: "provisioning"',
  'runtimeRoutingEnabled: false',
  'published: false',
  'provider: "jobtread"',
  'credentialConfigured: false',
  'carrier: "twilio"',
  'primaryNumberCapabilities: ["voice", "sms"]',
  'numberProvisioned: false',
  'runtimeEnabled: false',
]) requireText("tenant", text);

for (const text of [
  "resolveTenantSiteAuthority",
  'code: "ambiguous_site_mapping"',
  'code: "site_mapping_unavailable"',
  'code: "organization_inactive"',
  'code: "runtime_routing_disabled"',
]) requireText("authority", text);

for (const text of [
  'version: "oregon-no-general-sales-tax-2026-08-13"',
  "rate: 0",
  'active: false',
  'status: "approved"',
  "mileageRate: null",
]) requireText("pricing", text);

for (const text of [
  'activeDays: ["monday", "tuesday", "wednesday", "thursday", "friday"]',
  'status: "approved"',
  'serviceKey: "solar_panel_cleaning"',
  'serviceKey: "christmas_lights"',
]) requireText("tenant", text);

for (const text of [
  "blocks the current provisioning Klamath mapping",
  "resolves one exact active server-supplied mapping",
  "does not accept aliases, paths, or an Oregon fallback hostname",
  "fails closed for ambiguous, inactive, or runtime-disabled mappings",
]) requireText("tests", text);

const prohibitedConfigPatterns = [
  {
    pattern: /b1addf00-0000-4000-8000-000000000001/i,
    message: "Klamath config contains the DFW organization ID",
  },
  {
    pattern: /oregon\.bluladder\.com/i,
    message: "Klamath config contains an unapproved Oregon hostname alias",
  },
  {
    pattern: /\+1\s*\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4}/,
    message: "Klamath config contains a phone number",
  },
  {
    pattern: /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i,
    message: "Klamath config contains an email address",
  },
];
const configContent = [content.tenant, content.pricing, content.authority].join(
  "\n",
);
for (const { pattern, message } of prohibitedConfigPatterns) {
  if (pattern.test(configContent)) errors.push(message);
}

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`gate register is invalid JSON: ${error.message}`);
}

const expectedGates = new Map([
  ["typed_tenant_business_configuration", "ready"],
  ["exact_host_authority_contract", "ready"],
  ["inactive_territory_and_service_plan", "ready"],
  ["independent_pricing_draft", "ready"],
  ["hosted_organization_and_site_mapping", "blocked"],
  ["hosted_catalog_and_pricing_approval", "blocked"],
  ["jobtread_connector", "blocked"],
  ["twilio_number_and_messaging_registration", "blocked"],
  ["isolated_vapi_resources", "blocked"],
  ["tenant_scoped_runtime_paths", "blocked"],
  ["deployment_and_verification", "blocked"],
  ["owner_controlled_acceptance", "blocked"],
  ["activation", "blocked"],
]);
const expectedAuthorizedActions = [
  "merge",
  "deploy",
  "migration",
  "hosted_mutation",
  "provider_change",
  "credential_creation",
  "call_or_message",
  "lovable_credit",
];
if (register) {
  if (
    register.phase !== "1A" ||
    register.customer_facing_name !== "BluLadder Klamath" ||
    register.canonical_hostname !== "klamath.bluladder.com"
  ) errors.push("Phase 1A gate identity drifted");
  for (const key of [
    "activation_allowed",
    "customer_traffic_allowed",
    "runtime_routing_enabled",
    "site_published",
    "number_provisioned",
    "dfw_fallback_allowed",
    "pricing_runtime_enabled",
  ]) {
    if (register[key] !== false) errors.push(`${key} must remain false`);
  }
  if (
    register.lifecycle !== "provisioning" ||
    register.crm !== "jobtread" ||
    register.communications_carrier !== "twilio" ||
    register.pricing_status !== "draft"
  ) errors.push("Phase 1A inactive business configuration drifted");
  if (
    JSON.stringify(register.primary_number_capabilities) !==
      JSON.stringify(["voice", "sms"])
  ) errors.push("primary number must require voice and SMS capabilities");
  const actions = register.authorized_actions ?? {};
  if (
    Object.keys(actions).sort().join(",") !==
      [...expectedAuthorizedActions].sort().join(",") ||
    expectedAuthorizedActions.some((key) => actions[key] !== false)
  ) {
    errors.push("Phase 1A authorized-action boundary drifted");
  }
  const gates = register.gates ?? [];
  const actualGates = new Map(gates.map((gate) => [gate.id, gate.status]));
  if (
    gates.length !== expectedGates.size ||
    actualGates.size !== expectedGates.size
  ) errors.push("Phase 1A gate identity/count drifted");
  for (const [id, expected] of expectedGates) {
    if (actualGates.get(id) !== expected) {
      errors.push(`gate ${id} must remain ${expected}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1A contract OK: independent config present, exact-host authority fails closed, activation disabled.",
);
