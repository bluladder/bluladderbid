import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  migration: "supabase/migrations/20260815040824_bluladder_klamath_split_public_contact_channels.sql",
  preflight: "supabase/preflight/bluladder_klamath_split_public_contact_channels.sql",
  postflight: "supabase/verification/bluladder_klamath_split_public_contact_channels.sql",
  resolver: "supabase/functions/_shared/publicContactPublicationAuthority.ts",
  resolverTests: "supabase/functions/_shared/publicContactPublicationAuthority_test.ts",
  client: "src/lib/publicSite/klamathPublicSurface.ts",
  clientTests: "src/lib/publicSite/klamathPublicSurface.test.ts",
  page: "src/pages/KlamathCompliancePage.tsx",
  contract: "docs/architecture/bluladder-klamath-public-contact-authority.md",
  gates: "docs/operations/bluladder-klamath-split-public-contact-gates.json",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
  rehearsal: "scripts/rehearse-bluladder-klamath-split-public-contact-postgres.sh",
};
const expectedArtifacts = {
  migration: [4134, "2e116934a1cdedfe69fff28575a9223f95c882493e661f26e3cd955230b128f1"],
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
  "split call/text candidate prepared",
  "explicit `sms` channel",
  "values intentionally withheld from repository artifacts",
  "creates no contact row",
  "hosted application and resolver deployment remain separately gated",
]) requireText("contract", text);
for (const text of [
  "forward-only split-channel candidate",
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
    if (gates[key]?.path !== files[key] || gates[key]?.bytes !== bytes ||
        gates[key]?.sha256 !== sha256) {
      errors.push(`${key} artifact identity drifted in gate file`);
    }
  }
  for (const key of [
    "hosted_preflight_passed",
    "migration_applied",
    "postflight_passed",
    "contact_verified",
    "resolver_deployed",
    "frontend_published",
    "site_published",
    "customer_traffic_allowed",
    "activation_allowed",
  ]) {
    if (gates[key] !== false) errors.push(`${key} must remain false`);
  }
  if (Object.values(gates.authorized_actions ?? {}).some(Boolean)) {
    errors.push("split public-contact gate authorizes a protected action");
  }
  const ready = new Set([
    "owner_contact_approval",
    "distinct_call_and_text_contract",
    "repository_review",
  ]);
  if ((gates.gates ?? []).length !== 14) errors.push("split public-contact gate count drifted");
  for (const gate of gates.gates ?? []) {
    const expected = ready.has(gate.id) ? "ready" : "blocked";
    if (gate.status !== expected) errors.push(`gate ${gate.id} must be ${expected}`);
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath split public-contact gate OK: call/text channels are explicit and fail closed, no destination or row is embedded, DFW is preserved, and hosted/public actions remain separately blocked.",
);
