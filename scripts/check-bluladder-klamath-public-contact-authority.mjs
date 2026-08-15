import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  migration: "supabase/migrations/20260815031340_bluladder_klamath_public_contact_authority.sql",
  executionMigration: "supabase/migrations/20260815033840_ce894663-db30-45f4-90e8-817ae229615f.sql",
  preflight: "supabase/preflight/bluladder_klamath_public_contact_authority.sql",
  postflight: "supabase/verification/bluladder_klamath_public_contact_authority.sql",
  resolver: "supabase/functions/_shared/publicContactPublicationAuthority.ts",
  resolverTests: "supabase/functions/_shared/publicContactPublicationAuthority_test.ts",
  siteAuthority: "supabase/functions/_shared/publicSitePublicationAuthority.ts",
  siteTests: "supabase/functions/_shared/publicSitePublicationAuthority_test.ts",
  bootstrap: "supabase/functions/public-site-bootstrap/index.ts",
  client: "src/lib/publicSite/klamathPublicSurface.ts",
  clientTests: "src/lib/publicSite/klamathPublicSurface.test.ts",
  page: "src/pages/KlamathCompliancePage.tsx",
  types: "src/integrations/supabase/types.ts",
  inventory: "docs/architecture/tenant-inventory.json",
  contract: "docs/architecture/bluladder-klamath-public-contact-authority.md",
  gates: "docs/operations/bluladder-klamath-public-contact-authority-gates.json",
  evidence: "docs/operations/bluladder-klamath-public-contact-hosted-evidence.json",
  roadmap: "docs/ROADMAP_EXECUTION_LEDGER.md",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
  rehearsal: "scripts/rehearse-bluladder-klamath-public-contact-authority-postgres.sh",
};
const expectedArtifacts = {
  migration: [6570, "28a240ed2dc29577c5a0fdb66deca8a6c76abe09be0e4b0a4b361a6009d17de2"],
  executionMigration: [6569, "9d2cff0184f14c664c7bd93d43295df298ded15b0b954e3cdb3a249e76d6f86e"],
  preflight: [2956, "5feb692ac5c53f4fb64e0c46d1c937ce8794b631d6c133bab313c7e9ada5d3b2"],
  postflight: [5101, "7ce5ec31ecef11eac93229b2649a295f01499316c69740f9328ecb8d4b2f8625"],
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
  if (Buffer.byteLength(value) !== bytes) {
    errors.push(`${files[key]} byte size drifted`);
  }
  if (crypto.createHash("sha256").update(value).digest("hex") !== sha256) {
    errors.push(`${files[key]} SHA-256 drifted`);
  }
}

if (content.executionMigration !== content.migration?.replace(/\n$/, "")) {
  errors.push("Lovable execution receipt differs beyond terminal-LF normalization");
}

for (const text of [
  "BEGIN;",
  "LOCK TABLE",
  "CREATE TABLE public.organization_public_contacts",
  "channel IN ('phone', 'email')",
  "status IN ('draft', 'published', 'retired')",
  "organization_public_contacts_publication_gate_check",
  "owner_approval_reference_hash ~ '^[0-9a-f]{64}$'",
  "destination ~ '^\\+[1-9][0-9]{7,14}$'",
  "organization_public_contacts_one_published_channel_idx",
  "WHERE status = 'published'",
  "ENABLE ROW LEVEL SECURITY",
  "FROM PUBLIC, anon, authenticated, service_role",
  "TO authenticated",
  "TO service_role",
  'CREATE POLICY "Tenant operators view public contacts"',
  'CREATE POLICY "Tenant owners manage public contacts"',
  "actor.user_id = (SELECT auth.uid())",
  "actor.role IN ('owner', 'admin')",
  "COMMIT;",
]) requireText("migration", text);

if (/\b(?:insert\s+into|delete\s+from|merge\s+into)\b/i.test(content.migration ?? "") ||
    /\bupdate\s+(?:public\.)?[a-z_]+\s+set\b/i.test(content.migration ?? "")) {
  errors.push("public-contact migration contains forbidden data mutation");
}
for (const forbidden of [
  "CREATE TABLE IF NOT EXISTS",
  "CREATE OR REPLACE",
  "SECURITY DEFINER",
  "organization_public_contacts) VALUES",
  "GRANT ALL\n  ON TABLE public.organization_public_contacts TO authenticated",
]) {
  if (content.migration?.includes(forbidden)) {
    errors.push(`public-contact migration contains forbidden fragment: ${forbidden}`);
  }
}

for (const key of ["preflight", "postflight"]) {
  for (const text of [
    "BEGIN TRANSACTION READ ONLY;",
    "SET LOCAL statement_timeout = '15s';",
    "SET LOCAL lock_timeout = '3s';",
    "ROLLBACK;",
  ]) requireText(key, text);
  if (/\b(?:insert\s+into|delete\s+from|merge\s+into|create\s+table|alter\s+table|drop\s+table)\b/i.test(content[key] ?? "") ||
      /\bupdate\s+(?:public\.)?[a-z_]+\s+set\b/i.test(content[key] ?? "")) {
    errors.push(`${files[key]} is not read-only`);
  }
}
for (const text of [
  "target_table_count",
  "exact_dfw_default_count",
  "unexpected_legacy_default_count",
  "exact_klamath_provisioning_count",
  "exact_inactive_site_count",
  "internal_contact_count",
  "membership_count",
]) requireText("preflight", text);
for (const text of [
  "rls_enabled_table_count",
  "public_contact_count",
  "published_contact_count",
  "policy_count",
  "anon_grant_count",
  "authenticated_grant_count",
  "service_role_grant_count",
  "expected_index_count",
  "expected_column_count",
]) requireText("postflight", text);

for (const text of [
  "resolvePublishedPublicContacts",
  '.from("organization_public_contacts")',
  '.eq("organization_id", normalizedOrganizationId)',
  '.eq("status", "published")',
  ".limit(4)",
  "contact_missing",
  "contact_ambiguous",
  "contact_invalid",
  'return { status: "resolved", contacts: resolved }',
]) requireText("resolver", text);
if (content.resolver?.includes('.from("organization_contacts")') ||
    /\.select\(\s*["']\*["']\s*\)/.test(content.resolver ?? "")) {
  errors.push("public resolver reads internal contacts or uses wildcard selection");
}
for (const text of [
  "resolve reviewed call, text, and email without provenance",
  "fail closed when missing or unavailable",
  "reject duplicate channels and cross-organization rows",
  "reject draft, malformed, unverified, and unapproved rows",
]) requireText("resolverTests", text);

for (const text of [
  "resolvePublishedPublicContacts",
  "publicContactReady: contactAuthority.status === \"resolved\"",
  "publicContacts: contactAuthority.status === \"resolved\"",
]) requireText("siteAuthority", text);
for (const text of [
  "returns only separately approved public contacts",
  'assertFalse("owner_approval_reference_hash" in result)',
]) requireText("siteTests", text);
for (const text of [
  "publicContactReady: authority.publicContactReady",
  "publicContacts: authority.publicContacts",
]) requireText("bootstrap", text);
for (const forbidden of [
  "organizationId: authority.organizationId",
  "owner_approval_reference_hash: authority",
  "owner_approved_at: authority",
  "verified_at: authority",
  "published_at: authority",
]) {
  if (content.bootstrap?.includes(forbidden)) {
    errors.push(`public bootstrap exposes private authority: ${forbidden}`);
  }
}

for (const text of [
  "PublishedPublicContact",
  "parsePublicContacts",
  "publicContactHref",
  "publicContactReady: boolean",
  "publicContacts: PublishedPublicContact[]",
]) requireText("client", text);
for (const text of [
  "accepts only normalized unique reviewed contact payloads",
  "not-e164",
  "UPPER@example.com",
]) requireText("clientTests", text);
for (const text of [
  "publicContactHref(contact)",
  "contacts.length > 0",
  "Support is not published yet",
]) requireText("page", text);
for (const forbidden of [
  "PRIMARY_PUBLIC_PHONE",
  "SUPPORT_EMAIL",
  "contact-request",
  'href="tel:',
  'href="mailto:',
]) {
  if (content.page?.includes(forbidden)) {
    errors.push(`public page contains hardcoded/legacy contact path: ${forbidden}`);
  }
}

requireText("types", "organization_public_contacts: {");
requireText("types", 'foreignKeyName: "organization_public_contacts_organization_id_fkey"');
requireText("inventory", '"organization_public_contacts"');
requireText("contract", "separate");
requireText("contract", "`organization_public_contacts` table");
requireText("contract", "No contact is seeded");
requireText("contract", "foundational schema applied");
requireText("contract", "terminal-LF normalization");
requireText("roadmap", "Klamath public-contact authority");
requireText("roadmap", "terminal-LF-normalized execution receipt");
requireText("package", '"check:klamath-public-contact-authority"');
requireText("ci", "bun run check:klamath-public-contact-authority");
requireText("ci", "bluladder_klamath_public_contact_rehearsal");
requireText("ci", "rehearse-bluladder-klamath-public-contact-authority-postgres.sh");
for (const text of [
  "public-contact migration seeded data",
  "non-E.164 public phone was accepted",
  "unapproved public contact was published",
  "duplicate published channel was accepted",
  "public-contact constraint rehearsal was not rolled back",
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
    gates.stacked_on !== "2bcc8e422abdcaf5a98ba96fe53a9534ad74a854" ||
    gates.issue !== 178 ||
    gates.repository_implementation_ready !== true ||
    gates.separate_internal_and_public_contacts !== true ||
    gates.zero_seeded_public_contacts !== true ||
    gates.exact_dfw_compatibility !== true ||
    gates.server_authoritative_resolution !== true ||
    gates.anonymous_access_denied !== true
  ) errors.push("public-contact repository identity drifted");
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
    "function_deployed",
  ]) {
    if (gates[key] !== true) {
      errors.push(`${key} must be true after hosted reconciliation`);
    }
  }
  for (const key of [
    "owner_contact_approved",
    "contact_verified",
    "frontend_published",
    "site_published",
    "customer_traffic_allowed",
    "activation_allowed",
  ]) {
    if (gates[key] !== false) errors.push(`${key} must remain false`);
  }
  if (gates.hosted_evidence !== files.evidence) {
    errors.push("public-contact hosted evidence path drifted");
  }
  if (Object.values(gates.authorized_actions ?? {}).some(Boolean)) {
    errors.push("public-contact gate authorizes a protected action");
  }
  const ready = new Set([
    "separate_public_contact_schema",
    "least_privilege_rls",
    "server_contact_resolver",
    "missing_and_ambiguous_denial",
    "dfw_contact_leak_denial",
    "parent_pr_merge",
    "hosted_migration_preflight",
    "migration_application",
    "function_deployment",
  ]);
  if ((gates.gates ?? []).length !== 17) {
    errors.push("public-contact gate count drifted");
  }
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
    evidence.reviewed_source_main !== "0cc830219520acb2f38a07fd4cf41cc2b8329aca" ||
    evidence.lovable_execution_receipt_main !== "1c412e630d32791a3d0f2fc1b68d1da61256f104" ||
    evidence.execution_receipt?.path !== files.executionMigration ||
    evidence.execution_receipt?.bytes !== 6569 ||
    evidence.execution_receipt?.sha256 !==
      expectedArtifacts.executionMigration[1] ||
    evidence.execution_receipt?.normalization !== "canonical_payload_without_terminal_lf" ||
    evidence.ledger_before?.count !== 164 ||
    evidence.ledger_after?.count !== 165 ||
    evidence.ledger_after?.tip !== "20260815033840" ||
    evidence.postflight?.public_contacts !== 0 ||
    evidence.postflight?.published_contacts !== 0 ||
    evidence.postflight?.rls_enabled_tables !== 1 ||
    evidence.postflight?.policies !== 2 ||
    evidence.postflight?.anonymous_grants !== 0 ||
    evidence.edge_function?.slug !== "public-site-bootstrap" ||
    evidence.edge_function?.deployed !== true ||
    evidence.edge_function?.secret_free_get_status !== 405 ||
    evidence.edge_function?.canonical_dfw_origin_post_status !== 200 ||
    evidence.edge_function?.inactive_klamath_origin_post_status !== 404 ||
    evidence.frontend_published !== false ||
    evidence.public_contact_rows_created !== 0 ||
    evidence.site_published !== false ||
    evidence.customer_traffic_allowed !== false ||
    evidence.provider_actions !== false ||
    evidence.calls_or_messages !== false
  ) errors.push("public-contact hosted evidence drifted");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath public-contact authority gate OK: exact hosted receipt, empty additive schema, tenant RLS, no anonymous access, fail-closed publication proof, and public/customer activation blocked.",
);
