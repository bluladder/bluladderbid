import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  contract:
    "docs/architecture/bluladder-klamath-phase-0b-activation-contract.md",
  checklist:
    "docs/operations/bluladder-klamath-phase-0b-readiness-checklist.md",
  register: "docs/operations/bluladder-klamath-phase-0b-gates.json",
  handoff: "docs/voice/bluladder-klamath-handoff.md",
  phase0bTests: "src/test/bluladderKlamathPhase0B.test.ts",
  publicBooking: "supabase/functions/_shared/publicBookingServiceArea.ts",
  bookingReadiness: "supabase/functions/_shared/bookingReadiness.ts",
  availability: "supabase/functions/_shared/availabilityLookup.ts",
  voiceLinks: "supabase/functions/_shared/voice/voiceLinkTools.ts",
  customerSites: "supabase/functions/_shared/organizationCustomerSites.ts",
  customerSiteTests:
    "supabase/functions/_shared/organizationCustomerSites_test.ts",
  hangupLinks:
    "supabase/functions/_shared/voice/hangupBidLinkFollowup.ts",
  hangupTests:
    "supabase/functions/_shared/voice/hangupBidLinkFollowup_test.ts",
  portal: "supabase/functions/customer-portal-data/index.ts",
  phase1fRegister: "docs/operations/bluladder-klamath-phase-1f-gates.json",
  smsOutbox: "supabase/functions/_shared/smsOutbox.ts",
  autosync: "supabase/functions/jobber-autosync/index.ts",
  adminFlag: "src/lib/organizations/featureFlags.ts",
  uniqueness:
    "docs/architecture/tenant-stage-7d-uniqueness-classification.json",
};

const errors = [];
const content = {};
for (const [key, file] of Object.entries(relative)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) errors.push(`missing ${file}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

const requireText = (key, text) => {
  if (!content[key]?.includes(text))
    errors.push(`${relative[key]} omits: ${text}`);
};

for (const text of [
  "BluLadder Klamath",
  "JobTread only",
  "must never inherit DFW",
  "Current activation blockers",
  "activation_allowed",
])
  requireText("contract", text);
for (const text of [
  "NO-GO for activation",
  "Zero-credit read-only preflight",
  "Required implementation gates",
  "No Lovable AI message or credit consumption",
])
  requireText("checklist", text);
for (const text of [
  "JobTread connector",
  "Vapi assistant",
  "its own approved",
  "fail closed",
])
  requireText("handoff", text);

let register;
let phase1fRegister;
try {
  register = JSON.parse(content.register ?? "{}");
  phase1fRegister = JSON.parse(content.phase1fRegister ?? "{}");
} catch (error) {
  errors.push(`gate register is invalid JSON: ${error.message}`);
}

const expectedGateStatuses = new Map([
  ["repository_tenant_authority", "ready"],
  ["hosted_tenant_state", "unverified"],
  ["site_authority_and_links", "blocked"],
  ["public_quote_and_booking", "blocked"],
  ["portal_identity_and_appointments", "blocked"],
  ["pricing_and_service_catalog", "blocked"],
  ["jobtread_connector", "blocked"],
  ["messaging_and_outbox", "blocked"],
  ["background_jobs", "blocked"],
  ["uniqueness_and_identity_decisions", "blocked"],
  ["local_contacts", "unverified"],
  ["isolated_vapi_resources", "unverified"],
  ["controlled_acceptance_tests", "blocked"],
]);

if (register) {
  if (register.customer_facing_name !== "BluLadder Klamath") {
    errors.push("gate register customer-facing name drifted");
  }
  if (
    register.activation_allowed !== false ||
    register.dfw_fallback_allowed !== false
  ) {
    errors.push("Klamath activation or DFW fallback must remain disabled");
  }
  if (register.crm !== "jobtread")
    errors.push("Klamath CRM must remain JobTread");
  if (Object.values(register.authorized_actions ?? {}).some(Boolean)) {
    errors.push("Phase 0B register authorizes a prohibited action");
  }
  const actual = new Map(
    (register.gates ?? []).map((gate) => [gate.id, gate.status]),
  );
  if (actual.size !== expectedGateStatuses.size)
    errors.push("gate register count drifted");
  for (const [id, status] of expectedGateStatuses) {
    if (actual.get(id) !== status)
      errors.push(`gate ${id} must remain ${status}`);
  }
}

// Pure contract coverage carried forward from PR #81 on current main.
for (const [key, phrase] of [
  ["phase0bTests", "Klamath copy instead of DFW fallback"],
  ["phase0bTests", "Klamath calculation in manual review"],
  ["phase0bTests", "inactive Klamath from becoming authoritative"],
  ["phase0bTests", "Klamath JobTread remains unsupported"],
  ["phase0bTests", "Klamath never falls back to DFW Jobber"],
  ["phase0bTests", "Klamath and Lake planning rules remain inactive"],
  [
    "phase0bTests",
    "Klamath commercial and storefront services stay manual review",
  ],
])
  requireText(key, phrase);

// Current-code evidence for every major blocked gate. Phase 1B narrows the
// customer-link risk, but the Klamath site/link gate remains blocked until its
// hosted organization, publication, runtime, and customer-traffic flags pass.
requireText("publicBooking", "PUBLIC_DFW_COUNTIES");
requireText("bookingReadiness", "organizationPricingSupported");
requireText("availability", "provider_connector_unavailable_for_organization");
requireText("voiceLinks", "await loadOrganizationCustomerSiteRoutes(");
requireText("customerSites", 'code: "customer_site_unavailable"');
requireText(
  "customerSites",
  "export async function loadOrganizationCustomerSiteRoutes",
);
requireText(
  "customerSiteTests",
  "unknown organization never falls back to DFW",
);
requireText("hangupLinks", "buildBidLinkMessage(customerSite.baseUrl)");
requireText(
  "hangupTests",
  "unrouted organization cannot receive the generic DFW hangup link",
);
requireText("adminFlag", "ORGANIZATION_ADMIN_SURFACES_ENABLED = false");
if (content.portal?.includes("organization_id")) {
  if (
    phase1fRegister?.organization_scoped_portal_reads_prepared !== true ||
    phase1fRegister?.canonical_migration_applied !== false ||
    phase1fRegister?.portal_runtime_deployed !== false ||
    phase1fRegister?.activation_allowed !== false
  ) {
    errors.push(
      "portal tenant-scoping changed without the inactive Phase 1F release gate",
    );
  }
}
if (
  /interface OutboxSendInput[\s\S]{0,500}organizationId/.test(
    content.smsOutbox ?? "",
  )
) {
  errors.push(
    "outbox blocker evidence changed; review tenant scoping and gate status",
  );
}
if (content.autosync?.includes("organization_id")) {
  errors.push(
    "autosync blocker evidence changed; review tenant scoping and gate status",
  );
}
if (
  fs.existsSync(
    path.join(root, "supabase/functions/_shared/jobtreadConnectorAdapter.ts"),
  )
) {
  errors.push(
    "JobTread adapter now exists; re-audit capabilities before changing the gate",
  );
}

try {
  const entries = JSON.parse(content.uniqueness ?? "{}").entries ?? [];
  const ambiguous = entries.filter(
    (entry) => entry.classification === "ambiguous and requiring decision",
  ).length;
  const single = entries.filter(
    (entry) =>
      entry.classification ===
      "safe for single-organization compatibility only",
  ).length;
  if (ambiguous !== 11 || single !== 6) {
    errors.push(
      "uniqueness inventory changed; re-audit the Klamath activation gate",
    );
  }
} catch (error) {
  errors.push(`uniqueness inventory is invalid JSON: ${error.message}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 0B gate OK: activation disabled, no DFW fallback, current blockers acknowledged.",
);
