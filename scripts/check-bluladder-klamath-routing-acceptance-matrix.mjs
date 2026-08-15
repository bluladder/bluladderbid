import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  matrix:
    "docs/operations/bluladder-klamath-dfw-routing-acceptance-matrix.json",
  contract:
    "docs/architecture/bluladder-klamath-dfw-routing-acceptance-matrix.md",
  tests:
    "packages/tenant-config/bluladderKlamathRoutingAcceptanceMatrix.test.ts",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
  package: "package.json",
  workflow: ".github/workflows/ci.yml",
};

const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

let matrix;
try {
  matrix = JSON.parse(content.matrix ?? "{}");
} catch (error) {
  errors.push(`routing matrix is invalid JSON: ${error.message}`);
}

const requiredCategories = [
  "address_authoritative_routing",
  "organization_isolation",
  "provider_isolation",
  "missing_address",
  "rerouting",
  "idempotency",
  "manual_review_services",
];
const expectedAutomated = [
  "window_cleaning",
  "gutter_cleaning",
  "house_wash",
  "pressure_washing",
];
const expectedManual = [
  "solar_panel_cleaning",
  "christmas_lights",
  "commercial_exterior_cleaning",
  "storefront_window_cleaning",
];
const expectedDays = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

if (matrix?.schemaVersion !== 1 ||
  matrix?.contract !== "bluladder-klamath-dfw-routing-acceptance-matrix" ||
  matrix?.issue !== 162 || matrix?.status !== "repository_only") {
  errors.push("matrix identity or repository-only status drifted");
}
for (const gate of [
  "activationAuthorized",
  "providerTrafficPerformed",
  "customerMutationPerformed",
]) {
  if (matrix?.[gate] !== false) errors.push(`${gate} must remain false`);
}
if (JSON.stringify(matrix?.categories) !== JSON.stringify(requiredCategories)) {
  errors.push("required acceptance categories drifted");
}
for (const category of requiredCategories) {
  if (!matrix?.scenarios?.some((scenario) =>
    scenario?.categories?.includes(category)
  )) errors.push(`uncovered acceptance category ${category}`);
}

if (JSON.stringify(matrix?.approvedKlamathInputs?.activeDays) !==
  JSON.stringify(expectedDays)) errors.push("approved Klamath weekdays drifted");
if (JSON.stringify(matrix?.approvedKlamathInputs?.automatedServiceKeys) !==
  JSON.stringify(expectedAutomated)) errors.push("automated service set drifted");
if (JSON.stringify(matrix?.approvedKlamathInputs?.manualReviewServiceKeys) !==
  JSON.stringify(expectedManual)) errors.push("manual-review service set drifted");

if (matrix?.tenantContracts?.["bluladder-dfw"]?.provider !== "jobber" ||
  matrix?.tenantContracts?.["bluladder-klamath"]?.provider !== "jobtread" ||
  matrix?.tenantContracts?.["bluladder-klamath"]?.dfwFallbackAllowed !== false ||
  matrix?.tenantContracts?.["bluladder-klamath"]?.customerTrafficAllowed !== false) {
  errors.push("tenant/provider isolation contract drifted");
}

const scenarioIds = matrix?.scenarios?.map((scenario) => scenario.id) ?? [];
if (scenarioIds.length !== new Set(scenarioIds).size) {
  errors.push("scenario ids must be unique");
}
for (const id of [
  "dfw_address_selects_dfw_jobber",
  "klamath_address_blocks_while_provisioning",
  "klamath_address_selects_jobtread_after_separate_activation",
  "missing_address_fails_closed",
  "address_and_prior_organization_conflict_blocks",
  "corrected_address_discards_stale_tenant_and_provider",
  "klamath_jobber_provider_mismatch_blocks",
  "dfw_jobtread_provider_mismatch_blocks",
  "same_tenant_semantic_replay_is_idempotent",
  "same_external_key_is_not_shared_across_tenants",
  "manual_review_services_never_enter_automation",
]) {
  if (!scenarioIds.includes(id)) errors.push(`missing scenario ${id}`);
}
for (const scenario of matrix?.scenarios ?? []) {
  if (scenario.expected?.providerExecutionAllowedByThisContract !== false) {
    errors.push(`${scenario.id} must not authorize provider execution`);
  }
  if (scenario.expected?.dfwFallbackUsed !== false) {
    errors.push(`${scenario.id} must not use a DFW fallback`);
  }
  if (scenario.expected?.staleContextPreserved !== false) {
    errors.push(`${scenario.id} must discard stale context`);
  }
}

for (const phrase of [
  "normalized service address is authoritative",
  "never falls back to the DFW legacy default",
  "provider/organization mismatch blocks",
  "corrected address discards stale tenant and provider context",
  "Idempotency is scoped by organization",
  "manual review",
  "does not authorize Klamath activation",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
for (const phrase of [
  'activeDays: ["monday", "tuesday", "wednesday", "thursday", "friday"]',
  'dfwFallbackAllowed: false',
  'customerTrafficAllowed: false',
  'provider: "jobtread"',
]) {
  if (!content.tenant?.includes(phrase)) errors.push(`tenant config omits ${phrase}`);
}
for (const phrase of [
  "covers every required acceptance category",
  "routes only from address authority",
  "isolates provider selection by organization",
  "discards stale routing and idempotency context",
  "keeps every unapproved Klamath service on manual review",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
if (!content.package?.includes('"check:klamath-routing-acceptance-matrix"')) {
  errors.push("package script is missing");
}
if (!content.workflow?.includes("bun run check:klamath-routing-acceptance-matrix")) {
  errors.push("CI invocation is missing");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath / DFW routing acceptance matrix OK: address authority, tenant/provider isolation, re-routing, idempotency, and manual-review boundaries remain fail-closed.",
);
