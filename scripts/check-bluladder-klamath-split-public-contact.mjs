import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  migration: "supabase/migrations/20260815040824_bluladder_klamath_split_public_contact_channels.sql",
  executionMigration:
    "supabase/migrations/20260815043425_c06733ab-38c1-46e2-8003-4e23b1234cb1.sql",
  preflight: "supabase/preflight/bluladder_klamath_split_public_contact_channels.sql",
  postflight: "supabase/verification/bluladder_klamath_split_public_contact_channels.sql",
  resolver: "supabase/functions/_shared/publicContactPublicationAuthority.ts",
  resolverTests: "supabase/functions/_shared/publicContactPublicationAuthority_test.ts",
  client: "src/lib/publicSite/klamathPublicSurface.ts",
  clientTests: "src/lib/publicSite/klamathPublicSurface.test.ts",
  page: "src/pages/KlamathCompliancePage.tsx",
  contract: "docs/architecture/bluladder-klamath-public-contact-authority.md",
  gates: "docs/operations/bluladder-klamath-split-public-contact-gates.json",
  evidence: "docs/operations/bluladder-klamath-split-public-contact-hosted-evidence.json",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
  rehearsal: "scripts/rehearse-bluladder-klamath-split-public-contact-postgres.sh",
};
const expectedArtifacts = {
  migration: [4134, "2e116934a1cdedfe69fff28575a9223f95c882493e661f26e3cd955230b128f1"],
  executionMigration: [
    4133,
    "013f465ae46a6c119d52220ae14067c2bbe620fc4e27ffea538be52babd7fd54",
  ],
  preflight: [3735, "ba178667f46994843df4924b89ae8a7e56d583f07b8008a6ea074448b7e2021c"],
  postflight: [4757, "e3e911b04094ff812286b6097702f575ee50b728eac9b28ef0cd54082fefe415"],
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

for (const [key, [bytes, sha256]] of Object.entries(expectedArtifacts)) {
  const value = content[key] ?? "";
  if (Buffer.byteLength(value) !== bytes) errors.push(`${files[key]} byte size drifted`);
  if (crypto.createHash("sha256").update(value).digest("hex") !== sha256) {
    errors.push(`${files[key]} SHA-256 drifted`);
  }
}

if (content.executionMigration !== content.migration?.replace(/\n$/, "")) {
  errors.push("Lovable split-contact execution receipt differs beyond terminal-LF normalization");
}

for (const text of [
  "BEGIN;",
  "LOCK TABLE public.organization_public_contacts IN SHARE ROW EXCLUSIVE MODE;",
  "LOCK TABLE public.organizations, public.organization_customer_sites IN SHARE MODE;",
  "count(*) FROM public.organization_public_contacts) <> 0",
  "channel IN ('phone', 'sms', 'email')",
  "channel IN ('phone', 'sms')",
  "destination ~ '^\\+[1-9][0-9]{7,14}$'",
  "Split public contact DFW authority mismatch",
  "Split public contact Klamath inactive boundary mismatch",
  "COMMIT;",
]) requireText("migration", text);
if (/\b(?:insert\s+into|delete\s+from|merge\s+into)\b/i.test(content.migration ?? "") ||
    /\bupdate\s+(?:public\.)?[a-z_]+\s+set\b/i.test(content.migration ?? "")) {
  errors.push("split public-contact migration contains forbidden data mutation");
}
for (const forbidden of [
  "CREATE TABLE",
  "CREATE OR REPLACE",
  "SECURITY DEFINER",
  "GRANT ",
  "REVOKE ",
]) {
  if (content.migration?.includes(forbidden)) {
    errors.push(`split public-contact migration contains forbidden fragment: ${forbidden}`);
  }
}

for (const key of ["preflight", "postflight"]) {
  for (const text of [
    "BEGIN TRANSACTION READ ONLY;",
    "SET LOCAL statement_timeout = '15s';",
    "SET LOCAL lock_timeout = '3s';",
    "public_contact_count",
    "published_contact_count",
    "policy_count",
    "exact_dfw_default_count",
    "unexpected_legacy_default_count",
    "exact_klamath_provisioning_count",
    "exact_inactive_site_count",
    "ROLLBACK;",
  ]) requireText(key, text);
  if (/\b(?:insert\s+into|delete\s+from|merge\s+into|create\s+table|alter\s+table|drop\s+table)\b/i.test(content[key] ?? "") ||
      /\bupdate\s+(?:public\.)?[a-z_]+\s+set\b/i.test(content[key] ?? "")) {
    errors.push(`${files[key]} is not read-only`);
  }
}
for (const text of [
  "current_channel_constraint_count",
  "current_destination_constraint_count",
  "position('sms' IN pg_get_constraintdef(oid)) = 0",
]) requireText("preflight", text);
for (const text of [
  "split_channel_constraint_count",
  "split_destination_constraint_count",
  "position('sms' IN pg_get_constraintdef(oid)) > 0",
  "anon_grant_count",
  "authenticated_grant_count",
  "service_role_grant_count",
]) requireText("postflight", text);

for (const text of [
  'channel: "phone" | "sms" | "email"',
  'row.channel === "sms" && E164_PATTERN.test(row.destination)',
  '.limit(4)',
  'if (rows.length > 3)',
  '["phone", "sms", "email"]',
]) requireText("resolver", text);
for (const text of [
  "resolve reviewed call, text, and email without provenance",
  'channel: "sms"',
  "reject duplicate channels and cross-organization rows",
  'destination: "5415550102"',
]) requireText("resolverTests", text);

for (const text of [
  "channel: 'phone' | 'sms' | 'email'",
  "value.length > 3",
  "contact.channel === 'sms'",
  "return `sms:${contact.value}`",
]) requireText("client", text);
for (const text of [
  "publicContactHref",
  "sms:+15415550102",
  "channel: 'sms'",
]) requireText("clientTests", text);
for (const text of [
  "publicContactHref(contact)",
  "contact.label",
]) requireText("page", text);
for (const forbidden of ['href="tel:', 'href="sms:', 'href="mailto:']) {
  if (content.page?.includes(forbidden)) {
    errors.push(`public page hardcodes contact destination: ${forbidden}`);
  }
}

for (const text of [
  "split call/text contract applied",
  "explicit `sms` channel",
  "values intentionally withheld from repository artifacts",
  "creates no contact row",
  "split release record",
]) requireText("contract", text);
for (const text of [
  "forward-only split-channel release",
  "Lovable applied its exact reviewed",
  "It contains no destination value",
]) requireText("roadmap", text);
requireText("package", '"check:klamath-split-public-contact"');
requireText("ci", "bun run check:klamath-split-public-contact");
requireText("ci", "bluladder_klamath_split_public_contact_rehearsal");
requireText("ci", "rehearse-bluladder-klamath-split-public-contact-postgres.sh");
for (const text of [
  "non-E.164 public SMS was accepted",
  "distinct call and text contacts were not accepted",
  "duplicate published SMS channel was accepted",
  "split public-contact rehearsal was not rolled back",
]) requireText("rehearsal", text);

let gates;
try {
  gates = JSON.parse(content.gates ?? "{}");
} catch (error) {
  errors.push(`gate JSON is invalid: ${error.message}`);
}
if (gates) {
  if (
    gates.schema_version !== 1 ||
    gates.tenant_key !== "bluladder-klamath" ||
    gates.prepared_from_main !== "95be0e77d22481ed5001bbb34af497dafe30f092" ||
    gates.issue !== 151 ||
    gates.repository_implementation_ready !== true ||
    gates.owner_contact_approved !== true ||
    gates.reviewed_source_main !== "08b28360cd7cbbda3e36143c0be385c08ee3ab86" ||
    gates.lovable_execution_receipt_main !== "52b21539d38e9434f15ed849a7f68adadcfde481" ||
    gates.destinations_embedded_in_repository !== false ||
    gates.distinct_call_and_text_channels !== true ||
    gates.zero_seeded_public_contacts !== true ||
    gates.exact_dfw_compatibility !== true ||
    gates.inactive_klamath_boundary !== true
  ) errors.push("split public-contact repository identity drifted");
  if (
    gates.owner_approval_reference_sha256 !==
      "bda7cfd4df98e11adca544c31fde3746d49d6ea0712fc2440c09469ef5a94a86"
  ) {
    errors.push("owner approval reference fingerprint drifted");
  }
  for (const [key, [bytes, sha256]] of Object.entries(expectedArtifacts)) {
    if (key === "executionMigration") continue;
    if (gates[key]?.path !== files[key] || gates[key]?.bytes !== bytes ||
        gates[key]?.sha256 !== sha256) {
      errors.push(`${key} artifact identity drifted in gate file`);
    }
  }
  for (const key of [
    "hosted_preflight_passed",
    "migration_applied",
    "postflight_passed",
    "resolver_deployed",
  ]) {
    if (gates[key] !== true) errors.push(`${key} must be true after hosted reconciliation`);
  }
  for (const key of [
    "contact_verified",
    "frontend_published",
    "site_published",
    "customer_traffic_allowed",
    "activation_allowed",
  ]) {
    if (gates[key] !== false) errors.push(`${key} must remain false`);
  }
  if (gates.hosted_evidence !== files.evidence) {
    errors.push("split public-contact hosted evidence path drifted");
  }
  if (Object.values(gates.authorized_actions ?? {}).some(Boolean)) {
    errors.push("split public-contact gate authorizes a protected action");
  }
  const ready = new Set([
    "owner_contact_approval",
    "distinct_call_and_text_contract",
    "repository_review",
    "exact_head_ci",
    "merge",
    "hosted_preflight",
    "migration_application",
    "resolver_deployment",
  ]);
  if ((gates.gates ?? []).length !== 14) errors.push("split public-contact gate count drifted");
  for (const gate of gates.gates ?? []) {
    const expected = ready.has(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) errors.push(`gate ${gate.id} must be ${expected}`);
  }
}

let evidence;
try {
  evidence = JSON.parse(content.evidence ?? "{}");
} catch (error) {
  errors.push(`hosted evidence JSON is invalid: ${error.message}`);
}
if (evidence) {
  if (
    evidence.schema_version !== 1 ||
    evidence.tenant_key !== "bluladder-klamath" ||
    evidence.reviewed_source_main !== "08b28360cd7cbbda3e36143c0be385c08ee3ab86" ||
    evidence.lovable_execution_receipt_main !==
      "52b21539d38e9434f15ed849a7f68adadcfde481" ||
    evidence.canonical_migration?.path !== files.migration ||
    evidence.canonical_migration?.bytes !== expectedArtifacts.migration[0] ||
    evidence.canonical_migration?.sha256 !== expectedArtifacts.migration[1] ||
    evidence.execution_receipt?.path !== files.executionMigration ||
    evidence.execution_receipt?.bytes !== expectedArtifacts.executionMigration[0] ||
    evidence.execution_receipt?.sha256 !== expectedArtifacts.executionMigration[1] ||
    evidence.execution_receipt?.normalization !== "canonical_payload_without_terminal_lf" ||
    evidence.execution_receipt?.stored_statement_count !== 1 ||
    evidence.ledger_before?.count !== 165 ||
    evidence.ledger_before?.tip !== "20260815033840" ||
    evidence.ledger_before?.ordered_sha256 !==
      "78a3a8823e4baf9a78dc241a86f115658201a4f4939f480ecde3b45a465a0fd3" ||
    evidence.ledger_after?.count !== 166 ||
    evidence.ledger_after?.tip !== "20260815043425" ||
    evidence.ledger_after?.ordered_sha256 !==
      "5547fcde7712d1ac8d34de24d7061e8c39ef1545d3f321db63031280bc3d67a3" ||
    evidence.preflight?.target_tables !== 1 ||
    evidence.preflight?.rls_enabled_tables !== 1 ||
    evidence.preflight?.public_contacts !== 0 ||
    evidence.preflight?.published_contacts !== 0 ||
    evidence.preflight?.current_channel_constraints !== 1 ||
    evidence.preflight?.current_destination_constraints !== 1 ||
    evidence.preflight?.policies !== 2 ||
    evidence.preflight?.exact_dfw_default !== 1 ||
    evidence.preflight?.unexpected_legacy_defaults !== 0 ||
    evidence.preflight?.exact_klamath_provisioning !== 1 ||
    evidence.preflight?.exact_inactive_site !== 1 ||
    evidence.postflight?.target_tables !== 1 ||
    evidence.postflight?.rls_enabled_tables !== 1 ||
    evidence.postflight?.public_contacts !== 0 ||
    evidence.postflight?.published_contacts !== 0 ||
    evidence.postflight?.split_channel_constraints !== 1 ||
    evidence.postflight?.split_destination_constraints !== 1 ||
    evidence.postflight?.policies !== 2 ||
    evidence.postflight?.exact_view_policies !== 1 ||
    evidence.postflight?.exact_manage_policies !== 1 ||
    evidence.postflight?.anonymous_grants !== 0 ||
    evidence.postflight?.authenticated_grants !== 4 ||
    evidence.postflight?.service_role_grants !== 7 ||
    evidence.postflight?.exact_dfw_default !== 1 ||
    evidence.postflight?.unexpected_legacy_defaults !== 0 ||
    evidence.postflight?.exact_klamath_provisioning !== 1 ||
    evidence.postflight?.exact_inactive_site !== 1 ||
    evidence.dfw_baseline?.organization !==
      "1:a30b79cebb46dd94696ab0a6fa7d073f85055380b227f0fef4db528a6744d4c7" ||
    evidence.dfw_baseline?.settings !==
      "1:3b38cb0fb5ff1f376bdc5c0beee661531591a225e942fc3f62bf5567eed1aaca" ||
    evidence.dfw_baseline?.territories !==
      "0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
    evidence.dfw_baseline?.services !==
      "0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" ||
    evidence.dfw_baseline?.resolution_keys !==
      "4:f6525777a630a88531b34145ed85491edf4fd444a7d768b98ac125af406d8ef3" ||
    evidence.edge_function?.slug !== "public-site-bootstrap" ||
    evidence.edge_function?.deployed !== true ||
    evidence.edge_function?.active !== true ||
    evidence.edge_function?.verify_jwt !== false ||
    evidence.edge_function?.secret_free_get_status !== 405 ||
    evidence.edge_function?.clean_boot !== true ||
    evidence.edge_function?.boot_error_count !== 0 ||
    evidence.edge_function?.other_functions_deployed !== 0 ||
    evidence.lovable_ai_messages !== 1 ||
    evidence.repository_changes_from_lovable !== "execution_receipt_only" ||
    evidence.frontend_published !== false ||
    evidence.public_contact_rows_created !== 0 ||
    evidence.site_published !== false ||
    evidence.customer_traffic_allowed !== false ||
    evidence.provider_actions !== false ||
    evidence.calls_or_messages !== false
  ) errors.push("split public-contact hosted evidence drifted");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath split public-contact gate OK: the exact hosted receipt, split constraints, fail-closed resolver deployment, zero rows, and preserved inactive boundary are proven; reachability and publication remain blocked.",
);
