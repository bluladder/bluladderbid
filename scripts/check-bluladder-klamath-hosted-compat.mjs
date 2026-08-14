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
  phase1c:
    "supabase/migrations/20260813223348_bluladder_klamath_phase_1c_inactive_foundation.sql",
  preflight:
    "supabase/preflight/bluladder_klamath_stage_8a_hosted_compatibility.sql",
  verification:
    "supabase/verification/bluladder_klamath_stage_8a_hosted_compatibility.sql",
  contract:
    "docs/architecture/bluladder-klamath-stage-8a-hosted-compatibility.md",
  rehearsal:
    "scripts/rehearse-bluladder-klamath-stage-8a-hosted-compat-postgres.sh",
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
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const historicalSha = crypto
  .createHash("sha256")
  .update(content.historical ?? "")
  .digest("hex");
if (historicalSha !== "da28d7a939d7f47db42be97c0c473727ced0ecda0c6bea56081e4b147f24ffed") {
  errors.push("historical Stage 8A artifact drifted");
}

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
  "organization_memberships",
  "JOIN public.organizations tenant ON tenant.id = actor.organization_id",
  "actor.user_id = (SELECT auth.uid())",
  "tenant.status = 'active'",
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

for (const key of ["preflight", "verification"]) {
  if (!/BEGIN\s+TRANSACTION\s+READ\s+ONLY/i.test(content[key] ?? "")) {
    errors.push(`${relative[key]} is not explicitly read-only`);
  }
  if (/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(strippedSql(key))) {
    errors.push(`${relative[key]} contains a mutating SQL statement`);
  }
}

for (const text of [
  "Recreating the helper would undo the hardening",
  "Historical Stage 8A source remains byte-for-byte unchanged",
  "Any hosted application requires a new exact authorization",
]) requireText("contract", text);

for (const text of [
  "collision unexpectedly passed",
  "partial Stage 8A table state unexpectedly passed",
  "request.jwt.claim.sub",
  "historical_stage8a",
  "injected Stage 8A compatibility failure unexpectedly committed",
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
  "BluLadder Klamath hosted compatibility gate OK: historical Stage 8A is pinned, the retired public helper stays absent, direct tenant RLS is enforced, and all hosted actions remain separately gated.",
);
