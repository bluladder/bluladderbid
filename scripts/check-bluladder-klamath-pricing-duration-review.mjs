import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract:
    "docs/architecture/bluladder-klamath-pricing-duration-review.md",
  template:
    "docs/operations/bluladder-klamath-pricing-duration-review.template.json",
  implementation:
    "packages/tenant-config/bluladderKlamathPricingDurationReview.ts",
  tests:
    "packages/tenant-config/bluladderKlamathPricingDurationReview.test.ts",
  tenant: "packages/tenant-config/bluladderKlamath.ts",
};

const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

let template;
try {
  template = JSON.parse(content.template ?? "{}");
} catch (error) {
  errors.push(`pricing-duration template is invalid JSON: ${error.message}`);
}

const forbiddenKey =
  /^(?:secret|token|password|api_?key|grant_?key|headers?|provider_?id|account_?id|phone_?number|email_?address|webhook_?url|tool_?url)$/i;
function inspect(value, pathLabel = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      errors.push(`template contains prohibited field ${pathLabel}.${key}`);
    }
    inspect(child, `${pathLabel}.${key}`);
  }
}
inspect(template);

const candidate = template?.candidate;
if (
  candidate?.tenantKey !== "bluladder-klamath" ||
  candidate?.purpose !== "pricing_duration_owner_review" ||
  candidate?.profileKey !== "bluladder-klamath-pricing-draft" ||
  candidate?.profileVersion !== 1
) errors.push("pricing-duration candidate identity drifted");

const exactAutomated = [
  "window_cleaning",
  "gutter_cleaning",
  "house_wash",
  "pressure_washing",
];
const exactManual = [
  "solar_panel_cleaning",
  "christmas_lights",
  "commercial_exterior_cleaning",
  "storefront_window_cleaning",
];
if (JSON.stringify(candidate?.automatedServiceKeys) !== JSON.stringify(exactAutomated)) {
  errors.push("automated service boundary drifted");
}
if (JSON.stringify(candidate?.manualReviewServiceKeys) !== JSON.stringify(exactManual)) {
  errors.push("manual-review service boundary drifted");
}
if (
  candidate?.promotion99Enabled !== false ||
  candidate?.pricingRuntimeEnabled !== false ||
  candidate?.activationAllowed !== false
) errors.push("candidate runtime boundary must remain closed");
if (
  template?.ownerApproval?.status !== "pending" ||
  template?.ownerApproval?.recordRef !== null ||
  template?.ownerApproval?.approvedAt !== null ||
  template?.contractTestsPassed !== false
) errors.push("repository review template must remain pending and unverified");

for (const phrase of [
  "eligible_for_pricing_duration_gate",
  "activationAllowed: false",
  "candidate_snapshot_mismatch",
  "sensitive_field_present",
  "repository_runtime_boundary_open",
]) {
  if (!content.implementation?.includes(phrase)) {
    errors.push(`implementation omits ${phrase}`);
  }
}
for (const phrase of [
  "owner approval pending",
  "manual review",
  "pricing-and-duration gate",
  "activationAllowed: false",
]) {
  if (!content.contract?.includes(phrase)) errors.push(`contract omits ${phrase}`);
}
for (const phrase of [
  "keeps the repository template blocked",
  "can reach only the separate launch-input gate",
  "rejects pricing or duration drift",
  "leaves every runtime and activation surface closed",
]) {
  if (!content.tests?.includes(phrase)) errors.push(`tests omit ${phrase}`);
}
for (const phrase of [
  'lifecycle: "provisioning"',
  "activationAllowed: false",
  "customerTrafficAllowed: false",
  "runtimeRoutingEnabled: false",
  "published: false",
  'status: "draft"',
  "runtimeEnabled: false",
]) {
  if (!content.tenant?.includes(phrase)) {
    errors.push(`Klamath fail-closed authority omits ${phrase}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "Klamath pricing-duration review OK: exact candidate prepared, owner approval pending, runtime and activation disabled.",
);
