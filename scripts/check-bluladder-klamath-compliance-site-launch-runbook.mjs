import crypto from "node:crypto";
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
  migration:
    "supabase/migrations/20260815103000_bluladder_klamath_compliance_site_activation.sql",
  gates:
    "docs/operations/bluladder-klamath-compliance-site-activation-gates.json",
  contract:
    "docs/architecture/bluladder-klamath-compliance-site-activation.md",
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
]) requireText("runbook", text);

let evidence;
let gates;
try {
  evidence = JSON.parse(content.evidence ?? "{}");
  gates = JSON.parse(content.gates ?? "{}");
} catch (error) {
  errors.push(`launch JSON is invalid: ${error.message}`);
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

for (const review of Object.values(evidence?.reviews ?? {})) {
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
  gates?.activation_migration_application_authorized !== false ||
  gates?.activation_allowed !== false
) errors.push("activation gate does not bind the fail-closed launch package");

requireText("contract", files.runbook);
requireText("contract", files.evidence);
requireText("package", '"check:klamath-compliance-site-launch-runbook"');

if (errors.length) {
  console.error("Klamath compliance-site launch runbook failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath compliance-site launch runbook passed (exact fail-closed sequence; no production action authorized).",
);
