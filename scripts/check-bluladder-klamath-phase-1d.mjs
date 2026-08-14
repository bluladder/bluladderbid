import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-1d-customer-site-runtime.md",
  register: "docs/operations/bluladder-klamath-phase-1d-gates.json",
  sites: "supabase/functions/_shared/organizationCustomerSites.ts",
  siteTests: "supabase/functions/_shared/organizationCustomerSites_test.ts",
  voiceLinks: "supabase/functions/_shared/voice/voiceLinkTools.ts",
  voiceTests: "supabase/functions/_shared/voice/voiceLinkTools_test.ts",
  hangup: "supabase/functions/_shared/voice/hangupBidLinkFollowup.ts",
  marker: "supabase/functions/_shared/buildMarker.ts",
  markerTests: "supabase/functions/_shared/buildMarker_test.ts",
  phase1c: "docs/operations/bluladder-klamath-phase-1c-gates.json",
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
    "repository-only, inactive runtime implementation",
    "There is no hostname, geography, first-row",
    "DFW fallback for another organization",
    "organization is `provisioning`",
    "Suppression reads and the durable SMS outbox",
    "are not reached while any customer-site gate is closed",
    "Deployment remains separately gated",
  ]
) requireText("contract", text);

for (
  const text of [
    "export async function loadOrganizationCustomerSiteRoutes",
    'supabase.from("organizations")',
    'supabase.from("organization_customer_sites")',
    '.eq("id", authority)',
    '.eq("organization_id", authority)',
    ".limit(2)",
    "authority === DFW_ORGANIZATION_ID",
    "routes.every((route) => route !== null)",
  ]
) requireText("sites", text);
if (/\.select\(\s*["']\*["']\s*\)/.test(content.sites ?? "")) {
  errors.push("customer-site loader uses an unbounded wildcard selection");
}

for (
  const text of [
    "loader preserves exact DFW compatibility without a database read",
    "current hosted Klamath foundation loads but remains inactive",
    "one fully active hosted route resolves for its organization",
    "unreadable, malformed, and duplicate hosted evidence fails closed",
  ]
) requireText("siteTests", text);

for (
  const [key, fragments] of Object.entries({
    voiceLinks: [
      "await loadOrganizationCustomerSiteRoutes(",
      "resolveOrganizationCustomerSite(",
      "customerSiteRoutes",
    ],
    hangup: [
      "await loadOrganizationCustomerSiteRoutes(",
      "resolveOrganizationCustomerSite(",
      "customerSiteRoutes",
    ],
  })
) {
  for (const fragment of fragments) requireText(key, fragment);
}

for (
  const text of [
    "production runtime loads one active non-DFW customer site",
    "inactive hosted Klamath stops before suppression or delivery",
    "assertEquals(suppressionChecks, 0)",
    "assertEquals(deliveries, 0)",
  ]
) requireText("voiceTests", text);

for (
  const text of [
    'BUILD_ID = "voice-realtime-link-mvp.8-tenant-site-runtime"',
    "voiceRealtimeTenantCustomerSiteRuntime: true",
  ]
) requireText("marker", text);
for (
  const text of [
    '"voice-realtime-link-mvp.8-tenant-site-runtime"',
    "BUILD_FEATURES.voiceRealtimeTenantCustomerSiteRuntime",
  ]
) requireText("markerTests", text);

let register;
let phase1c;
try {
  register = JSON.parse(content.register ?? "{}");
  phase1c = JSON.parse(content.phase1c ?? "{}");
} catch (error) {
  errors.push(`Klamath gate JSON is invalid: ${error.message}`);
}

if (register) {
  if (
    register.phase !== "1D" ||
    register.prepared_from_main !==
      "8551b86253a227767359887995fbe1e21d1937be" ||
    register.hosted_foundation_execution_version !== "20260814050336" ||
    register.build_marker !==
      "voice-realtime-link-mvp.8-tenant-site-runtime" ||
    register.database_backed_site_loader !== true ||
    register.dfw_exact_compatibility !== true ||
    register.hosted_organization_provisioned !== true
  ) errors.push("Phase 1D repository/hosted identity drifted");

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
  if (register.lifecycle !== "provisioning") {
    errors.push("Klamath lifecycle must remain provisioning");
  }
  if (Object.values(register.authorized_actions ?? {}).some(Boolean)) {
    errors.push("Phase 1D authorizes a protected action");
  }

  const expected = new Map([
    ["server_resolved_organization_authority", "ready"],
    ["database_backed_customer_site_loader", "ready"],
    ["dfw_exact_link_compatibility", "ready"],
    ["inactive_klamath_link_denial", "ready"],
    ["voice_link_runtime_adoption", "ready"],
    ["hangup_link_runtime_adoption", "ready"],
    ["site_publication_and_customer_traffic", "blocked"],
    ["tenant_scoped_portal_and_appointments", "blocked"],
    ["tenant_scoped_messaging_and_outbox", "blocked"],
    ["jobtread_connector", "blocked"],
    ["twilio_and_vapi_resources", "blocked"],
    ["deployment_and_verification", "blocked"],
    ["owner_controlled_acceptance", "blocked"],
    ["activation", "blocked"],
  ]);
  const actual = new Map(
    (register.gates ?? []).map((gate) => [gate.id, gate.status]),
  );
  if (actual.size !== expected.size) errors.push("Phase 1D gate count drifted");
  for (const [id, status] of expected) {
    if (actual.get(id) !== status) errors.push(`gate ${id} must be ${status}`);
  }
}

if (
  phase1c &&
  (phase1c.migration_applied !== true ||
    phase1c.hosted_organization_provisioned !== true ||
    phase1c.activation_allowed !== false ||
    phase1c.customer_traffic_allowed !== false)
) errors.push("Phase 1C inactive hosted prerequisite drifted");

for (
  const text of [
    "Klamath Phase 1D",
    "database-backed customer-site runtime",
    "customer traffic remains blocked",
  ]
) requireText("roadmap", text);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1D gate OK: database-backed tenant site routing is adopted by both voice link paths, DFW compatibility is exact, and inactive Klamath stops before customer delivery.",
);
