import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  historical:
    "supabase/migrations/20260728070000_organization_routing_stage_8a.sql",
  migration:
    "supabase/migrations/20260814022314_bluladder_klamath_stage_8a_hosted_compatibility.sql",
  receipt:
    "supabase/migrations/20260814035656_f333948e-a5c5-4e5a-9958-b4ed1ee77dc2.sql",
  grantRepair:
    "supabase/migrations/20260814041512_bluladder_klamath_stage_8a_authenticated_grants.sql",
  grantReceipt:
    "supabase/migrations/20260814045913_a2d7679c-4504-469d-87a5-f6c21edbfa97.sql",
  phase1c:
    "supabase/migrations/20260813223348_bluladder_klamath_phase_1c_inactive_foundation.sql",
  phase1cReceipt:
    "supabase/migrations/20260814050336_e5e2c901-cd2c-479c-a5be-71746296fd9b.sql",
  preflight:
    "supabase/preflight/bluladder_klamath_stage_8a_hosted_compatibility.sql",
  verification:
    "supabase/verification/bluladder_klamath_stage_8a_hosted_compatibility.sql",
  grantPreflight:
    "supabase/preflight/bluladder_klamath_stage_8a_authenticated_grants.sql",
  grantVerification:
    "supabase/verification/bluladder_klamath_stage_8a_authenticated_grants.sql",
  contract:
    "docs/architecture/bluladder-klamath-stage-8a-hosted-compatibility.md",
  grantContract:
    "docs/architecture/bluladder-klamath-stage-8a-authenticated-grant-repair.md",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-stage-8a-hosted-compat-postgres.sh",
  types: "src/integrations/supabase/types.ts",
  gitleaksIgnore: ".gitleaksignore",
};

const content = {};
const errors = [];
for (const [key, file] of Object.entries(relative)) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) errors.push(`missing ${file}`);
  else content[key] = fs.readFileSync(full, "utf8");
}

function requireText(key, text) {
  if (!content[key]?.includes(text)) {
    errors.push(`${relative[key]} omits: ${text}`);
  }
}

function strippedSql(key) {
  return (content[key] ?? "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const historicalSha = crypto
  .createHash("sha256")
  .update(content.historical ?? "")
  .digest("hex");
if (historicalSha !== "da28d7a939d7f47db42be97c0c473727ced0ecda0c6bea56081e4b147f24ffed") {
  errors.push("historical Stage 8A artifact drifted");
}

const canonicalSha = crypto
  .createHash("sha256")
  .update(content.migration ?? "")
  .digest("hex");
const expectedCanonicalSha = [
  "765d5158b839047ea6c27697e2743d9bc",
  "3573f7d7e130ea5181bae7b4d526c72",
].join("");
if (canonicalSha !== expectedCanonicalSha) {
  errors.push("applied canonical Stage 8A artifact drifted");
}

const receiptSha = crypto
  .createHash("sha256")
  .update(content.receipt ?? "")
  .digest("hex");
const expectedReceiptSha = [
  "6b304572f5b607b27297f5e8318a372a",
  "a4fdf2d4a667645f30c5832c31fdfa96",
].join("");
if (receiptSha !== expectedReceiptSha) {
  errors.push("Lovable Stage 8A execution receipt drifted");
}
if (`${content.receipt ?? ""}\n` !== (content.migration ?? "")) {
  errors.push("Lovable receipt is not the terminal-LF-normalized canonical payload");
}

for (const [receiptKey, canonicalKey, expectedSha, label] of [
  [
    "grantReceipt",
    "grantRepair",
    "59ebbf2dd7a10ee8ccb4fa378f83181906186a610e904b14121b1943f8954ebc",
    "Stage 8A authenticated-grant repair",
  ],
  [
    "phase1cReceipt",
    "phase1c",
    "b7fb60f90775f7315447e467e31ddc0313806d101274d7918b7885915eca4b7b",
    "Phase 1C inactive-foundation",
  ],
]) {
  const actualSha = crypto
    .createHash("sha256")
    .update(content[receiptKey] ?? "")
    .digest("hex");
  if (actualSha !== expectedSha) {
    errors.push(`Lovable ${label} execution receipt drifted`);
  }
  if (`${content[receiptKey] ?? ""}\n` !== (content[canonicalKey] ?? "")) {
    errors.push(
      `Lovable ${label} receipt is not the terminal-LF-normalized canonical payload`,
    );
  }
}

// Generated types are cumulative and advance with every later hosted
// migration. Exact historical receipts remain pinned above; verify the
// required structural entries rather than freezing the entire generated file.
for (const table of [
  "organization_contacts",
  "organization_connector_operation_attempts",
  "organization_connector_webhook_receipts",
  "organization_crm_connectors",
  "organization_customer_sites",
  "organization_messaging_connectors",
  "organization_pricing_profiles",
  "organization_services",
  "organization_settings",
  "organization_territories",
]) {
  requireText("types", `${table}: {`);
}
requireText("types", "consent_allows_for_organization: {");
requireText("types", "record_organization_consent: {");
for (const text of [
  "claim_organization_sms_outbox_send: {",
  "p_messaging_connector_id: string",
  "p_organization_id: string",
  "p_outbound_key: string",
  "Returns: Json",
]) requireText("types", text);

for (const text of [
  "BEGIN;",
  "SET LOCAL lock_timeout = '5s'",
  "SET LOCAL statement_timeout = '30s'",
  "Partial Stage 8A table state detected",
  "Obsolete public tenant-membership helper is present",
  "CREATE TABLE IF NOT EXISTS public.organization_settings",
  "CREATE TABLE IF NOT EXISTS public.organization_contacts",
  "CREATE TABLE IF NOT EXISTS public.organization_territories",
  "CREATE TABLE IF NOT EXISTS public.organization_services",
  "JOIN public.organizations tenant ON tenant.id = actor.organization_id",
  "actor.user_id = (SELECT auth.uid())",
  "tenant.status = 'active'",
  "REVOKE ALL",
  "FROM anon",
  "Oregon test fixture gained an activation surface",
  "COMMIT;",
]) requireText("migration", text);

for (const text of [
  "BEGIN;",
  "Authenticated privilege drift is not the observed Stage 8A state",
  "REVOKE ALL PRIVILEGES",
  "FROM authenticated",
  "GRANT SELECT, INSERT, UPDATE, DELETE",
  "Phase 1C state exists; apply the Stage 8A grant repair first",
  "Authenticated role retains an excess privilege",
  "COMMIT;",
]) requireText("grantRepair", text);

for (const text of [
  "organization_memberships",
  "JOIN public.organizations tenant ON tenant.id = actor.organization_id",
  "actor.user_id = (SELECT auth.uid())",
  "tenant.status = 'active'",
  "FROM anon, authenticated",
  "Phase 1C authenticated role retains excess access",
]) requireText("phase1c", text);

for (const [key, sql] of [
  ["migration", strippedSql("migration")],
  ["phase1c", strippedSql("phase1c")],
]) {
  if (/USING\s*\(\s*public\.is_organization_member\s*\(/i.test(sql)) {
    errors.push(`${relative[key]} still calls the obsolete public helper`);
  }
  if (/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.is_organization_member/i.test(sql)) {
    errors.push(`${relative[key]} recreates the obsolete public helper`);
  }
  if (/actor\.user_id\s*=\s*auth\.uid\(\)/i.test(sql)) {
    errors.push(`${relative[key]} does not use the cached auth.uid predicate`);
  }
}

if (/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(strippedSql("migration"))) {
  errors.push("compatibility migration contains destructive DDL");
}
if (/SECURITY\s+DEFINER/i.test(strippedSql("migration"))) {
  errors.push("compatibility migration adds a SECURITY DEFINER object");
}
if (/SECURITY\s+DEFINER/i.test(strippedSql("grantRepair"))) {
  errors.push("grant repair adds a SECURITY DEFINER object");
}
if (/\b(?:CREATE\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i.test(strippedSql("grantRepair"))) {
  errors.push("grant repair changes schema or tenant data");
}
if (/GRANT\s+ALL[\s\S]*?TO\s+authenticated/i.test(strippedSql("grantRepair"))) {
  errors.push("grant repair grants ALL to authenticated");
}
if (/b1addf00-0000-4000-8000-000000000003|bluladder-klamath/i.test(strippedSql("migration"))) {
  errors.push("Stage 8A compatibility migration mutates Klamath Phase 1C state");
}
for (const prohibited of [
  /INSERT\s+INTO\s+public\.organization_contacts/i,
  /INSERT\s+INTO\s+public\.organization_memberships/i,
  /INSERT\s+INTO\s+public\.organization_services/i,
  /\+1\d{10}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
]) {
  if (prohibited.test(strippedSql("migration"))) {
    errors.push(`compatibility migration contains prohibited pattern: ${prohibited}`);
  }
}

for (const key of [
  "preflight",
  "verification",
  "grantPreflight",
  "grantVerification",
]) {
  if (!/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i.test(content[key] ?? "")) {
    errors.push(`${relative[key]} is not explicitly read-only`);
  }
  if (/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(strippedSql(key))) {
    errors.push(`${relative[key]} contains a mutating SQL statement`);
  }
}

for (const text of [
  "Hosted execution version `20260814035656`",
  "Historical Stage 8A source remains byte-for-byte unchanged",
  "all provider, runtime, publication, and traffic gates remain off",
]) requireText("contract", text);

for (const text of [
  "Those generated artifacts are authoritative evidence",
  "canonical applied migration also remains immutable",
  "revokes authenticated access and restores only",
  "Hosted execution version `20260814045913`",
]) requireText("grantContract", text);

for (const text of [
  "collision unexpectedly passed",
  "partial Stage 8A table state unexpectedly passed",
  "request.jwt.claim.sub",
  "historical_stage8a",
  "injected Stage 8A compatibility failure unexpectedly committed",
  "Stage 8A authenticated grant repair",
  "REFERENCES",
  "TRIGGER",
  "TRUNCATE",
]) requireText("rehearsal", text);

const expectedFalsePositiveFingerprint =
  "a04271a80504914f472b8129fb4a78fc857b6e92:" +
  "scripts/check-bluladder-klamath-hosted-compat.mjs:" +
  "generic-api-key:133";
const ignoredFingerprints = (content.gitleaksIgnore ?? "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
if (
  ignoredFingerprints.length !== 1 ||
  ignoredFingerprints[0] !== expectedFalsePositiveFingerprint
) {
  errors.push("Gitleaks exception is not the one exact historical fingerprint");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath hosted compatibility gate OK: all three applied artifacts and Lovable receipts are reconciled, required generated types are present, tenant grants are least-privilege, and every activation surface remains gated.",
);
