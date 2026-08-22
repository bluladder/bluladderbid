import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  legacyMigration:
    "supabase/migrations/20260815103000_bluladder_klamath_compliance_site_activation.sql",
  migration:
    "supabase/migrations/20260822170000_bluladder_klamath_activation_supersession.sql",
  preflight:
    "supabase/preflight/bluladder_klamath_activation_supersession.sql",
  postflight:
    "supabase/verification/bluladder_klamath_activation_supersession.sql",
  trafficCutover:
    "supabase/operations/bluladder_klamath_customer_traffic_cutover.sql",
  trafficPause:
    "supabase/operations/bluladder_klamath_customer_traffic_pause.sql",
  trafficPostflight:
    "supabase/verification/bluladder_klamath_customer_traffic_cutover.sql",
  architecture:
    "docs/architecture/bluladder-klamath-activation-supersession.md",
  protectedBindings:
    "docs/operations/bluladder-klamath-activation-protected-bindings.template.json",
  receipt:
    "docs/operations/bluladder-klamath-activation-receipt.template.json",
  emailReceipt:
    "docs/operations/bluladder-klamath-email-routing.receipt.json",
  pricingApproval:
    "docs/operations/bluladder-klamath-pricing-duration-review.approved.json",
  gates:
    "docs/operations/bluladder-klamath-activation-supersession-gates.json",
  voiceRuntime: "supabase/functions/_shared/voice/voiceHumanTransfer.ts",
  voiceTests: "supabase/functions/_shared/voice/voiceHumanTransfer_test.ts",
  marker: "supabase/functions/_shared/buildMarker.ts",
  manifest: "supabase/functions/_shared/voiceProviderKlamathConfig.ts",
  complianceChecker:
    "scripts/check-bluladder-klamath-compliance-site-activation.mjs",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
};

const content = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(absolute, "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) errors.push(`${files[key]} omits: ${text}`);
}

const legacy = Buffer.from(content.legacyMigration ?? "", "utf8");
if (
  legacy.length !== 9_939 ||
  sha256(legacy) !==
    "8743e66464403d67973180146c82ea82df2360d793fe737a1846900c0568c3a8"
) {
  errors.push("superseded migration changed byte-for-byte");
}

const manifest = Buffer.from(content.manifest ?? "", "utf8");
if (
  manifest.length !== 9_195 ||
  sha256(manifest) !==
    "f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1"
) {
  errors.push("approved Klamath Vapi manifest identity drifted");
}

for (const text of [
  "BEGIN;",
  "20260815103000",
  "Superseded Klamath compliance migration was applied",
  "customer_traffic_allowed = false",
  "'vapi_assistant'",
  "'vapi_phone_number'",
  "[\"transfer_destination\"]",
  "[\"operational_alert_recipient\"]",
  "bluladder-klamath-twilio-production-v1",
  "'window_cleaning'",
  "'gutter_cleaning'",
  "'house_wash'",
  "'pressure_washing'",
  "status = 'approved', runtime_enabled = true",
  "status = 'active', updated_at = now()",
  "COMMIT;",
]) requireText("migration", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY;",
  "protected_authority_fingerprint",
  "superseded_version_count",
  "replacement_version_count",
  "customer_traffic_allowed = false",
  "ROLLBACK;",
]) requireText("preflight", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY;",
  "staged_site_count",
  "published_phone_count",
  "published_email_count",
  "active_transfer_destination_count",
  "active_operational_alert_count",
  "active_jobtread_count",
  "ROLLBACK;",
]) requireText("postflight", text);

for (const text of [
  "DO NOT EXECUTE until",
  "20260815103000",
  "20260822170000",
  "customer_traffic_allowed = false",
  "SET customer_traffic_allowed = true, updated_at = now()",
  "GET DIAGNOSTICS affected_rows = ROW_COUNT",
  "affected_rows <> 1",
  "Klamath traffic cutover DFW invariant failed",
  "COMMIT;",
]) requireText("trafficCutover", text);

for (const text of [
  "Emergency fail-closed pause",
  "SET customer_traffic_allowed = false, updated_at = now()",
  "AND customer_traffic_allowed = true",
  "GET DIAGNOSTICS affected_rows = ROW_COUNT",
  "affected_rows <> 1",
  "Klamath traffic pause DFW invariant failed",
  "COMMIT;",
]) requireText("trafficPause", text);

for (const text of [
  "BEGIN TRANSACTION READ ONLY;",
  "superseded_version_count",
  "replacement_version_count",
  "live_site_count",
  "active_assistant_count",
  "active_phone_count",
  "active_transfer_destination_count",
  "active_operational_alert_count",
  "ROLLBACK;",
]) requireText("trafficPostflight", text);

const forbiddenReadOnlySql = /\b(?:insert\s+into|update\s+[a-z_.]+\s+set|delete\s+from|merge\s+into|create\s+(?:table|index|policy)|alter\s+table|drop\s+(?:table|index|policy)|truncate|grant|revoke|call)\b/i;
for (const key of ["preflight", "postflight", "trafficPostflight"]) {
  if (forbiddenReadOnlySql.test(content[key] ?? "")) {
    errors.push(`${files[key]} contains a forbidden mutation`);
  }
}

const forbiddenOperationSql = /\b(?:insert\s+into|delete\s+from|merge\s+into|create\s+(?:table|index|policy)|alter\s+table|drop\s+(?:table|index|policy)|truncate|grant|revoke|call)\b/i;
for (const key of ["trafficCutover", "trafficPause"]) {
  if (forbiddenOperationSql.test(content[key] ?? "")) {
    errors.push(`${files[key]} contains an unrelated mutation`);
  }
  const updates = content[key]?.match(/UPDATE\s+public\.[a-z_]+/gi) ?? [];
  if (
    updates.length !== 1 ||
    updates[0].toLowerCase() !== "update public.organization_customer_sites"
  ) errors.push(`${files[key]} is not an exact one-table, one-update operation`);
}

for (const text of [
  "mode: \"separated\" | \"legacy_shared\"",
  "VOICE_TRANSFER_DESTINATION_CATEGORY",
  "VOICE_OPERATIONAL_ALERT_RECIPIENT_CATEGORY",
  "resolveAuthoritativeVoiceAuthorities",
  "transferDestination",
  "operationalAlertRecipient",
  "private_authority_published",
  "classified_authority_ambiguous",
]) requireText("voiceRuntime", text);

for (const text of [
  "separated authorities transfer to the destination",
  "unclassified DFW primary preserves the exact legacy shared authority",
  "legacy DFW provider-accepted transfer preserves no-alert behavior",
  "classified private authority is rejected when published",
  "provider-accepted same-call link blocks transfer",
  "destination: \"+12145550000\"",
]) requireText("voiceTests", text);

requireText(
  "marker",
  "voice-realtime-link-mvp.9-klamath-authority-separation",
);

for (const text of [
  "superseded_unapplied",
  "customer site with traffic still disabled",
  "legacy_shared",
  "automatically available",
  "JobTread connector remains inactive",
]) requireText("architecture", text);

let protectedBindings;
let receipt;
let emailReceipt;
let pricingApproval;
let gates;
for (const key of [
  "protectedBindings",
  "receipt",
  "emailReceipt",
  "pricingApproval",
  "gates",
]) {
  try {
    const parsed = JSON.parse(content[key] ?? "{}");
    if (key === "protectedBindings") protectedBindings = parsed;
    if (key === "receipt") receipt = parsed;
    if (key === "emailReceipt") emailReceipt = parsed;
    if (key === "pricingApproval") pricingApproval = parsed;
    if (key === "gates") gates = parsed;
  } catch (error) {
    errors.push(`${files[key]} is invalid JSON: ${error.message}`);
  }
}

if (
  protectedBindings?.contains_private_values !== false ||
  protectedBindings?.voice_authorities?.length !== 2 ||
  protectedBindings?.binding_execution?.performed !== false
) errors.push("protected binding template is not fail closed");

if (
  receipt?.sensitive_values_in_receipt !== false ||
  receipt?.superseded_migration?.classification !== "superseded_unapplied" ||
  receipt?.runtime?.customer_traffic_allowed !== false
) errors.push("activation receipt template is not sanitized and fail closed");

if (
  emailReceipt?.status !== "verified" ||
  emailReceipt?.creation_method !== "google_group_no_additional_license" ||
  emailReceipt?.group_unique_match_count !== 1 ||
  emailReceipt?.external_member_count !== 1 ||
  emailReceipt?.delivery_test?.attempt_count !== 1 ||
  emailReceipt?.delivery_test?.sent_to_group_members !== true ||
  emailReceipt?.delivery_test?.accepted_for_archiving !== true ||
  emailReceipt?.delivery_test?.external_member_handoff !==
    "delivered_to_google_internal_server" ||
  emailReceipt?.safeguards?.paid_license_created !== false ||
  emailReceipt?.safeguards?.mx_or_dns_changed !== false ||
  emailReceipt?.safeguards?.private_member_disclosed !== false
) errors.push("Workspace email delivery receipt is incomplete or unsafe");

if (
  pricingApproval?.approved_candidate_sha256 !==
    "d69f072d0510393304cc382ec0140c385a7d8bb2302b6ccdab7592149e1e21a4" ||
  pricingApproval?.hosted_snapshot_sha256 !==
    "cc56912810e31f3cb508e3062bf16526cb9767629347fe4d75142a37d0ecccd2" ||
  pricingApproval?.automated_service_keys?.length !== 4 ||
  pricingApproval?.manual_review_service_keys?.length !== 2
) errors.push("pricing activation evidence drifted");

const migration = Buffer.from(content.migration ?? "", "utf8");
const emailReceiptBytes = Buffer.from(content.emailReceipt ?? "", "utf8");
const trafficCutover = Buffer.from(content.trafficCutover ?? "", "utf8");
const trafficPause = Buffer.from(content.trafficPause ?? "", "utf8");
const trafficPostflight = Buffer.from(content.trafficPostflight ?? "", "utf8");
if (
  gates?.schema_version !== 1 ||
  gates?.tenant_key !== "bluladder-klamath" ||
  gates?.superseded_migration?.path !== files.legacyMigration ||
  gates?.superseded_migration?.classification !== "superseded_unapplied" ||
  gates?.replacement_migration?.path !== files.migration ||
  gates?.replacement_migration?.bytes !== migration.length ||
  gates?.replacement_migration?.sha256 !== sha256(migration) ||
  gates?.workspace_email_evidence?.path !== files.emailReceipt ||
  gates?.workspace_email_evidence?.bytes !== emailReceiptBytes.length ||
  gates?.workspace_email_evidence?.sha256 !== sha256(emailReceiptBytes) ||
  gates?.workspace_email_evidence?.status !== "verified" ||
  gates?.workspace_email_evidence?.external_delivery_verified !== true ||
  gates?.customer_traffic_cutover?.path !== files.trafficCutover ||
  gates?.customer_traffic_cutover?.bytes !== trafficCutover.length ||
  gates?.customer_traffic_cutover?.sha256 !== sha256(trafficCutover) ||
  gates?.customer_traffic_cutover?.exact_update_count !== 1 ||
  gates?.customer_traffic_cutover?.allowed_before_all_post_deploy_gates !==
    false ||
  gates?.fail_closed_traffic_pause?.path !== files.trafficPause ||
  gates?.fail_closed_traffic_pause?.bytes !== trafficPause.length ||
  gates?.fail_closed_traffic_pause?.sha256 !== sha256(trafficPause) ||
  gates?.fail_closed_traffic_pause?.exact_update_count !== 1 ||
  gates?.fail_closed_traffic_pause?.purpose !== "fail_closed_only" ||
  gates?.read_only_traffic_postflight?.path !== files.trafficPostflight ||
  gates?.read_only_traffic_postflight?.bytes !== trafficPostflight.length ||
  gates?.read_only_traffic_postflight?.sha256 !== sha256(trafficPostflight) ||
  gates?.customer_traffic_allowed_before_deploy !== false ||
  gates?.customer_traffic_cutover_prepared !== true ||
  gates?.activation_allowed !== false
) errors.push("activation supersession gate identity drifted");

// The repository stores only public destinations. Compare fingerprints of every
// E.164/email literal in the release files against protected values without
// embedding any protected value itself.
const protectedValueHashes = new Set([
  "5634195d7b461a4ef99799146b1146c7f85e042931ca87246cfb9beadc22af65",
  "f413a45efe96381f82754c03dc0005c41785393303bda45837e2cd458f111008",
  "733e21f1aa22bbaeb3bbd52b5377e1f6ce0531e81262611c14991c84c44089d8",
]);
for (const key of [
  "migration",
  "preflight",
  "postflight",
  "trafficCutover",
  "trafficPause",
  "trafficPostflight",
  "architecture",
  "protectedBindings",
  "receipt",
  "emailReceipt",
  "pricingApproval",
  "gates",
  "voiceRuntime",
  "voiceTests",
]) {
  const literals = [
    ...((content[key] ?? "").match(/\+[1-9][0-9]{7,14}/g) ?? []),
    ...((content[key] ?? "").match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    ) ?? []),
  ];
  for (const literal of literals) {
    if (protectedValueHashes.has(sha256(literal.toLowerCase()))) {
      errors.push(`${files[key]} contains a protected destination literal`);
    }
  }
}

requireText("package", '"check:klamath-activation-supersession"');
requireText(
  "complianceChecker",
  'import("./check-bluladder-klamath-activation-supersession.mjs")',
);
requireText("ci", "bun run check:klamath-compliance-site-activation");

if (errors.length) {
  console.error("Klamath activation supersession contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath activation supersession contract passed (traffic remains disabled pending deploy verification).",
);
