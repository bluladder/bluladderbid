import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  runbook: "docs/operations/bluladder-klamath-path-compliance-launch-runbook.md",
  surface: "src/lib/publicSite/klamathPublicSurface.ts",
  surfaceTests: "src/lib/publicSite/klamathPublicSurface.test.ts",
  page: "src/pages/KlamathCompliancePage.tsx",
  copy: "src/lib/publicSite/klamathComplianceCopy.ts",
  template: "docs/operations/bluladder-klamath-messaging-compliance-review.template.json",
  manifest: "docs/operations/bluladder-klamath-compliance-copy-review-manifest.json",
};

const errors = [];
const content = {};
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(absolute, "utf8");
}

function requireText(key, fragment) {
  if (!content[key]?.includes(fragment)) errors.push(`${files[key]} omits: ${fragment}`);
}

for (const fragment of [
  "implementation prepared",
  "Owner approval cannot substitute for qualified review",
  "bid.bluladder.com/klamath",
  "does not enable Klamath customer traffic",
  "existing DFW application",
  "do not prompt Lovable AI",
  "approved `$15` campaign vetting charge",
  "Do not reconnect or make `klamath.bluladder.com` primary",
]) requireText("runbook", fragment);

for (const fragment of [
  "KLAMATH_PUBLIC_PATH_PREFIX = '/klamath'",
  "pathBasedComplianceRoute",
  "host === DFW_PUBLIC_HOSTNAME",
  "mode: 'existing_dfw'",
  "publicContactReady: false",
  "publicContacts: []",
]) requireText("surface", fragment);

for (const fragment of [
  "'/klamath', '/opt-in'",
  "'/klamath/privacy', '/privacy'",
  "'/klamath/services'",
  "mode: 'existing_dfw'",
]) requireText("surfaceTests", fragment);

for (const fragment of [
  "Text messaging consent",
  "KLAMATH_OPT_IN_COPY",
  "Support is not published yet",
  "pathPrefix = ''",
]) requireText("page", fragment);
for (const forbidden of ["<form", "<input", "supabase.functions", "customer-portal"]) {
  if (content.page?.includes(forbidden)) errors.push(`${files.page} contains ${forbidden}`);
}

const exactUrls = [
  "https://bid.bluladder.com/klamath",
  "https://bid.bluladder.com/klamath/privacy",
  "https://bid.bluladder.com/klamath/terms",
  "https://bid.bluladder.com/klamath/contact",
];
for (const url of exactUrls) requireText("template", url);
for (const url of exactUrls.slice(1).filter((url) => !url.endsWith("/terms"))) {
  requireText("copy", url);
}
if (content.template?.includes("https://klamath.bluladder.com")) {
  errors.push("messaging template still references the unsupported custom host");
}

let template;
let manifest;
try {
  template = JSON.parse(content.template ?? "{}");
  manifest = JSON.parse(content.manifest ?? "{}");
} catch (error) {
  errors.push(`path compliance JSON is invalid: ${error.message}`);
}
if (
  template?.candidate?.sourceImplementationChanged !== true ||
  template?.candidate?.publicSurfacesPublished !== false ||
  template?.candidate?.providerCampaignSubmitted !== false ||
  template?.candidate?.messagingRuntimeEnabled !== false ||
  template?.candidate?.customerTrafficAllowed !== false ||
  template?.candidate?.activationAllowed !== false ||
  template?.ownerApproval?.status !== "pending" ||
  template?.legalReview?.status !== "pending"
) errors.push("path candidate review or fail-closed state drifted");
if (
  manifest?.owner_review?.status !== "pending" ||
  manifest?.qualified_legal_compliance_review?.status !== "pending" ||
  manifest?.production_action_authorized !== false
) errors.push("immutable path bundle is not waiting for both exact reviews");

if (errors.length) {
  console.error("Klamath path compliance launch contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath path compliance launch contract passed (exact paths only; DFW and all runtimes preserved; reviews and campaign submission remain gated).",
);

