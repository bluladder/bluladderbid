import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  runbook:
    "docs/operations/bluladder-klamath-compliance-site-launch-runbook.md",
  evidence:
    "docs/operations/bluladder-klamath-compliance-site-launch-evidence.template.json",
  reviewManifest:
    "docs/operations/bluladder-klamath-compliance-copy-review-manifest.json",
  migration:
    "supabase/migrations/20260815103000_bluladder_klamath_compliance_site_activation.sql",
  gates:
    "docs/operations/bluladder-klamath-compliance-site-activation-gates.json",
  contract:
    "docs/architecture/bluladder-klamath-compliance-site-activation.md",
  evidenceValidator:
    "scripts/validate-bluladder-klamath-compliance-site-launch-evidence.mjs",
  package: "package.json",
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

for (const text of [
  "prepared, not authorized for production execution",
  "Freeze the reviewed release",
  "Close the review gates",
  "Verify and publish the public contacts",
  "Publish the dormant frontend first",
  "Connect and verify the custom domain",
  "Run the immutable hosted preflight",
  "Apply only the reviewed lifecycle migration",
  "Run postflight and browser acceptance",
  "Keep later provider releases separate",
  "Owner approval cannot substitute for qualified review",
  "candidate-bundle SHA-256",
  files.reviewManifest,
  "one `phone` channel and one `sms` channel",
  "Connecting the Klamath hostname",
  "no conflicting `AAAA` record",
]) {
  requireText("runbook", text);
}
for (const text of [
  "supabase/preflight/bluladder_klamath_compliance_site_activation.sql",
  "supabase/verification/bluladder_klamath_compliance_site_activation.sql",
  files.migration,
  "customer traffic false",
  "Lovable AI, edit source",
  "existing approved campaign is not",
  files.evidenceValidator,
]) requireText("runbook", text);

let evidence;
let gates;
let reviewManifest;
try {
  evidence = JSON.parse(content.evidence ?? "{}");
  gates = JSON.parse(content.gates ?? "{}");
  reviewManifest = JSON.parse(content.reviewManifest ?? "{}");
} catch (error) {
  errors.push(`launch JSON is invalid: ${error.message}`);
}

const expectedReviewArtifacts = [
  "src/lib/publicSite/klamathComplianceCopy.ts",
  "src/pages/KlamathCompliancePage.tsx",
  "docs/operations/bluladder-klamath-messaging-compliance-review.template.json",
];
const reviewArtifactLines = [];
if (
  reviewManifest?.schema_version !== 1 ||
  reviewManifest?.tenant_key !== "bluladder-klamath" ||
  reviewManifest?.purpose !== "immutable_compliance_copy_review_candidate" ||
  reviewManifest?.candidate_bundle?.algorithm !== "sha256" ||
  reviewManifest?.candidate_bundle?.serialization !==
    "newline_joined_path_bytes_sha256" ||
  JSON.stringify(reviewManifest?.public_contact_boundary?.required_channels) !==
    JSON.stringify(["phone", "sms"]) ||
  reviewManifest?.public_contact_boundary?.protected_values_included !== false ||
  reviewManifest?.public_contact_boundary?.reachability_evidence_included !== false ||
  reviewManifest?.production_action_authorized !== false
) errors.push("copy-review manifest identity or fail-closed boundary drifted");
if (
  reviewManifest?.owner_review?.status !== "pending" ||
  reviewManifest?.owner_review?.record_ref !== null ||
  reviewManifest?.owner_review?.reviewed_at !== null ||
  reviewManifest?.qualified_legal_compliance_review?.status !== "pending" ||
  reviewManifest?.qualified_legal_compliance_review?.record_ref !== null ||
  reviewManifest?.qualified_legal_compliance_review?.reviewed_at !== null
) errors.push("copy-review manifest must remain an unapproved candidate");
if (
  JSON.stringify((reviewManifest?.artifacts ?? []).map(({ path }) => path)) !==
  JSON.stringify(expectedReviewArtifacts)
) errors.push("copy-review artifact set or order drifted");
for (const artifact of reviewManifest?.artifacts ?? []) {
  const absolute = path.join(root, artifact.path ?? "");
  if (!expectedReviewArtifacts.includes(artifact.path) || !fs.existsSync(absolute)) {
    errors.push(`copy-review artifact is missing or unapproved: ${artifact.path}`);
    continue;
  }
  const buffer = fs.readFileSync(absolute);
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  if (artifact.bytes !== buffer.length || artifact.sha256 !== sha256) {
    errors.push(`copy-review artifact identity drifted: ${artifact.path}`);
  }
  reviewArtifactLines.push(`${artifact.path}:${buffer.length}:${sha256}`);
}
const reviewBundleSha256 = crypto
  .createHash("sha256")
  .update(reviewArtifactLines.join("\n"))
  .digest("hex");
if (reviewManifest?.candidate_bundle?.sha256 !== reviewBundleSha256) {
  errors.push("copy-review candidate bundle fingerprint drifted");
}

const forbiddenKey = /^(?:secret|token|password|api_?key|grant_?key|headers?|provider_?id|account_?id|phone_?number|email_?address|webhook_?url|tool_?url|destination)$/i;
function inspectKeys(value, pathLabel = "$") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      errors.push(`evidence template contains prohibited field ${pathLabel}.${key}`);
    }
    inspectKeys(child, `${pathLabel}.${key}`);
  }
}
inspectKeys(evidence);

const migrationBuffer = Buffer.from(content.migration ?? "", "utf8");
const migrationSha256 = crypto
  .createHash("sha256")
  .update(migrationBuffer)
  .digest("hex");
if (
  evidence?.schema_version !== 1 ||
  evidence?.tenant_key !== "bluladder-klamath" ||
  evidence?.purpose !== "compliance_site_launch_window_evidence" ||
  evidence?.release?.main_sha !== null ||
  evidence?.release?.pr_186_merged !== false ||
  evidence?.release?.migration_path !== files.migration ||
  evidence?.release?.migration_bytes !== migrationBuffer.length ||
  evidence?.release?.migration_sha256 !== migrationSha256
) errors.push("launch evidence release identity or pending state drifted");

if (
  evidence?.reviews?.candidate_manifest_path !== files.reviewManifest ||
  evidence?.reviews?.candidate_bundle_sha256 !== reviewBundleSha256
) errors.push("launch evidence is not bound to the immutable copy-review candidate");

for (const review of [
  evidence?.reviews?.exact_owner_copy_review,
  evidence?.reviews?.qualified_legal_compliance_review,
]) {
  if (
    review?.status !== "pending" ||
    review?.record_ref !== null ||
    review?.reviewed_at !== null
  ) errors.push("launch evidence review must remain pending");
}
if (
  evidence?.public_contacts?.exact_channel_count !== 2 ||
  evidence?.public_contacts?.distinct_destination_count !== 2 ||
  evidence?.public_contacts?.call_reachability !== "unverified" ||
  evidence?.public_contacts?.text_reachability !== "unverified" ||
  evidence?.public_contacts?.evidence_fingerprints_present !== false ||
  evidence?.public_contacts?.published_count !== 0
) errors.push("launch evidence contact state must remain fail-closed");

for (const section of [
  evidence?.frontend,
  evidence?.domain,
  evidence?.hosted_preflight,
  evidence?.migration_application,
  evidence?.postflight,
  evidence?.browser_acceptance,
  evidence?.later_provider_releases,
  evidence?.production_actions,
]) {
  if (!section || typeof section !== "object") {
    errors.push("launch evidence section is missing");
  }
}
if (
  evidence?.frontend?.published !== false ||
  evidence?.frontend?.lovable_ai_messages_used !== 0 ||
  evidence?.domain?.connected !== false ||
  evidence?.hosted_preflight?.passed !== false ||
  evidence?.migration_application?.separately_authorized !== false ||
  evidence?.migration_application?.applied !== false ||
  evidence?.migration_application?.ledger_entry_count !== 0 ||
  evidence?.postflight?.passed !== false ||
  evidence?.postflight?.customer_traffic_allowed !== false ||
  evidence?.postflight?.provider_runtimes_enabled !== 0 ||
  evidence?.production_actions?.calls_placed !== 0 ||
  evidence?.production_actions?.messages_sent !== 0 ||
  evidence?.production_actions?.customer_data_created !== 0 ||
  evidence?.production_actions?.customer_runtime_enabled !== false ||
  evidence?.launch_complete !== false
) errors.push("launch evidence template authorizes or records a production action");
for (const value of Object.values(evidence?.later_provider_releases ?? {})) {
  if (value !== false) errors.push("later provider release must remain false");
}

if (
  gates?.launch_runbook_ready !== true ||
  gates?.launch_evidence_template_ready !== true ||
  gates?.copy_review_manifest_ready !== true ||
  gates?.activation_migration_application_authorized !== false ||
  gates?.activation_allowed !== false
) errors.push("activation gate does not bind the fail-closed launch package");

requireText("contract", files.runbook);
requireText("contract", files.evidence);
requireText("package", '"check:klamath-compliance-site-launch-runbook"');
requireText("package", '"check:klamath-compliance-site-launch-evidence"');
for (const text of [
  "validateCompletedEvidence",
  "candidate_bundle_sha256",
  "customer_traffic_allowed",
  "provider_runtimes_enabled",
  "customer_routes_denied",
  "later_provider_releases",
  "production_actions",
  "--self-test",
]) requireText("evidenceValidator", text);

const validatorSelfTest = spawnSync(
  process.execPath,
  [path.join(root, files.evidenceValidator), "--self-test"],
  { encoding: "utf8" },
);
if (validatorSelfTest.status !== 0) {
  errors.push("launch-evidence validator self-test failed");
}

if (errors.length) {
  console.error("Klamath compliance-site launch runbook failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath compliance-site launch runbook passed (exact fail-closed sequence; no production action authorized).",
);
