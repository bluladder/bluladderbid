import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1b-contract.md",
  register: "docs/operations/bluladder-klamath-phase-1b-gates.json",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
  authority: "packages/tenant-config/siteAuthority.ts",
  sites: "supabase/functions/_shared/organizationCustomerSites.ts",
  siteTests: "supabase/functions/_shared/organizationCustomerSites_test.ts",
  voiceLinks: "supabase/functions/_shared/voice/voiceLinkTools.ts",
  voiceTests: "supabase/functions/_shared/voice/voiceLinkTools_test.ts",
  hangupLinks:
    "supabase/functions/_shared/voice/hangupBidLinkFollowup.ts",
  hangupTests:
    "supabase/functions/_shared/voice/hangupBidLinkFollowup_test.ts",
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
  "repository-only, inactive routing implementation",
  "There is no geographic, first-record, hostname, or DFW fallback",
  "DFW compatibility boundary",
  "Klamath remains inactive",
  "Remaining release gates",
]) requireText("contract", text);

for (const text of [
  "resolveTenantSiteAuthority",
  'code: "ambiguous_site_mapping"',
  'code: "site_mapping_unavailable"',
]) requireText("authority", text);

for (const text of [
  "resolveOrganizationCustomerSite",
  'code: "customer_site_unavailable"',
  'code: "ambiguous_customer_site"',
  'code: "site_unpublished"',
  'code: "customer_traffic_disabled"',
  'code: "invalid_customer_site_url"',
  "There is no geographic, hostname, DFW, or first-record fallback",
]) requireText("sites", text);

for (const text of [
  "DFW exact organization keeps its canonical customer URL",
  "unknown organization never falls back to DFW",
  "Klamath activation gates fail independently",
  "invalid, ambiguous, or unsafe routes fail closed",
]) requireText("siteTests", text);

for (const text of [
  "resolveOrganizationCustomerSite(",
  "buildDfwCustomerSiteRoute(deps.appUrl ?? getAppUrl())",
  "customerSite.baseUrl",
  "Do not send a text, disclose another location's website, or claim success.",
]) requireText("voiceLinks", text);
if (
  content.voiceLinks?.includes(
    "buildVoiceCustomerLink(toolName, deps.appUrl ?? getAppUrl())",
  )
) {
  errors.push("voice link path still contains the global DFW URL fallback");
}
for (const text of [
  "an unrouted tenant cannot receive the DFW customer link",
  "assertEquals(suppressionChecks, 0)",
  "assertEquals(deliveries, 0)",
]) requireText("voiceTests", text);
for (const text of [
  "resolveOrganizationCustomerSite(",
  'detail: "customer_site_unavailable"',
  "buildBidLinkMessage(customerSite.baseUrl)",
]) requireText("hangupLinks", text);
for (const text of [
  "unrouted organization cannot receive the generic DFW hangup link",
  'detail: "customer_site_unavailable"',
  'sb.touched.includes("system_test_config")',
  "assertEquals(deliver.calls.length, 0)",
]) requireText("hangupTests", text);

for (const text of [
  'organizationId: null',
  'lifecycle: "provisioning"',
  'activationAllowed: false',
  'customerTrafficAllowed: false',
  'dfwFallbackAllowed: false',
  'mappingStatus: "unprovisioned"',
  'runtimeRoutingEnabled: false',
  'published: false',
  'numberProvisioned: false',
]) requireText("tenant", text);

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`gate register is invalid JSON: ${error.message}`);
}

const expectedGates = new Map([
  ["exact_host_authority_contract", "ready"],
  ["organization_scoped_customer_site_resolver", "ready"],
  ["dfw_exact_link_compatibility", "ready"],
  ["unknown_tenant_link_denial", "ready"],
  ["inactive_klamath_link_denial", "ready"],
  ["hosted_organization_and_site_mapping", "blocked"],
  ["site_publication_and_runtime_wiring", "blocked"],
  ["tenant_scoped_public_quote_and_booking", "blocked"],
  ["tenant_scoped_portal_and_appointments", "blocked"],
  ["tenant_scoped_messaging_and_outbox", "blocked"],
  ["jobtread_connector", "blocked"],
  ["twilio_and_vapi_resources", "blocked"],
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
    register.phase !== "1B" ||
    register.customer_facing_name !== "BluLadder Klamath" ||
    register.canonical_hostname !== "klamath.bluladder.com"
  ) errors.push("Phase 1B gate identity drifted");
  for (const key of [
    "activation_allowed",
    "customer_traffic_allowed",
    "runtime_routing_enabled",
    "site_published",
    "hosted_organization_provisioned",
    "dfw_fallback_allowed",
    "number_provisioned",
  ]) {
    if (register[key] !== false) errors.push(`${key} must remain false`);
  }
  if (register.lifecycle !== "provisioning") {
    errors.push("Klamath lifecycle must remain provisioning");
  }
  const actions = register.authorized_actions ?? {};
  if (
    Object.keys(actions).sort().join(",") !==
      [...expectedAuthorizedActions].sort().join(",") ||
    expectedAuthorizedActions.some((key) => actions[key] !== false)
  ) {
    errors.push("Phase 1B authorized-action boundary drifted");
  }
  const gates = register.gates ?? [];
  const actualGates = new Map(gates.map((gate) => [gate.id, gate.status]));
  if (
    gates.length !== expectedGates.size ||
    actualGates.size !== expectedGates.size
  ) errors.push("Phase 1B gate identity/count drifted");
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
  "BluLadder Klamath Phase 1B gate OK: customer links are organization-scoped, Klamath remains inactive, and DFW has no tenant fallback.",
);
