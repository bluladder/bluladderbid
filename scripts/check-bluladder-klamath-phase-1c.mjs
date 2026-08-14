import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative = {
  migration:
    "supabase/migrations/20260813223348_bluladder_klamath_phase_1c_inactive_foundation.sql",
  receipt:
    "supabase/migrations/20260814050336_e5e2c901-cd2c-479c-a5be-71746296fd9b.sql",
  preflight: "supabase/preflight/bluladder_klamath_phase_1c.sql",
  verification: "supabase/verification/bluladder_klamath_phase_1c.sql",
  contract:
    "docs/architecture/bluladder-klamath-phase-1c-contract.md",
  register: "docs/operations/bluladder-klamath-phase-1c-gates.json",
  pricing: "packages/tenant-config/bluladderKlamathPricingDraft.ts",
  rehearsal: "scripts/rehearse-bluladder-klamath-phase-1c-postgres.sh",
  types: "src/integrations/supabase/types.ts",
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

for (const text of [
  "BEGIN;",
  "LOCK TABLE",
  "Phase 1C target tables already exist; inspect before retry",
  "Stage 8A authenticated grant repair prerequisite is not exact",
  "CREATE TABLE public.organization_customer_sites",
  "CREATE TABLE public.organization_pricing_profiles",
  "ALTER TABLE public.organization_customer_sites ENABLE ROW LEVEL SECURITY",
  "ALTER TABLE public.organization_pricing_profiles ENABLE ROW LEVEL SECURITY",
  "JOIN public.organizations tenant ON tenant.id = actor.organization_id",
  "actor.user_id = (SELECT auth.uid())",
  "tenant.status = 'active'",
  "FROM anon, authenticated",
  "DO $phase1c_privilege_postflight$",
  "Phase 1C authenticated role retains excess access",
  "organization_customer_sites_activation_check",
  "organization_customer_sites_traffic_check",
  "organization_pricing_profiles_runtime_check",
  "'bluladder-klamath'",
  "'BluLadder Klamath'",
  "'klamath.bluladder.com'",
  "'provisioning'",
  "'disabled'",
  "'inactive'",
  "'manual_review'",
  "'draft'",
  "$klamath_pricing$",
  "COMMIT;",
]) requireText("migration", text);

if (/USING\s*\(\s*public\.is_organization_member\s*\(/i.test(content.migration ?? "")) {
  errors.push("Phase 1C still calls the retired public membership helper");
}
if (/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.is_organization_member/i.test(content.migration ?? "")) {
  errors.push("Phase 1C recreates the retired public membership helper");
}

function strippedSql(key) {
  return (content[key] ?? "")
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/'(?:''|[^'])*'/g, "''");
}

const receiptSha = crypto
  .createHash("sha256")
  .update(content.receipt ?? "")
  .digest("hex");
if (
  receiptSha !==
  "b7fb60f90775f7315447e467e31ddc0313806d101274d7918b7885915eca4b7b"
) {
  errors.push("Lovable Phase 1C execution receipt drifted");
}
if (`${content.receipt ?? ""}\n` !== (content.migration ?? "")) {
  errors.push(
    "Lovable Phase 1C receipt is not the terminal-LF-normalized canonical payload",
  );
}

const typesSha = crypto
  .createHash("sha256")
  .update(content.types ?? "")
  .digest("hex");
if (
  typesSha !==
  "6d828accf7e1d8da3239e817a31d6ec61f4e3ebe6f31643db60039f70ba4a450"
) {
  errors.push("Lovable-generated hosted types drifted");
}
for (const table of [
  "organization_customer_sites",
  "organization_messaging_connectors",
  "organization_pricing_profiles",
]) requireText("types", `${table}: {`);
for (const text of [
  "claim_organization_sms_outbox_send: {",
  "p_messaging_connector_id: string",
  "p_organization_id: string",
  "p_outbound_key: string",
  "Returns: Json",
  "consent_allows_for_organization: {",
  "record_organization_consent: {",
]) requireText("types", text);

for (const prohibited of [
  /INSERT\s+INTO\s+public\.organization_contacts/i,
  /INSERT\s+INTO\s+public\.organization_memberships/i,
  /\+1\d{10}/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /\b(?:TRUNCATE|DROP\s+TABLE|DROP\s+COLUMN)\b/i,
]) {
  if (prohibited.test(strippedSql("migration"))) {
    errors.push(`migration contains prohibited pattern: ${prohibited}`);
  }
}

const hostname = "klamath.bluladder.com";
const expectedHostnameHash = crypto
  .createHash("sha256")
  .update(hostname)
  .digest("hex");
if (!content.migration?.includes(`'${expectedHostnameHash}'`)) {
  errors.push("migration hostname SHA-256 does not match canonical hostname");
}

const pricingMatch = content.migration?.match(
  /\$klamath_pricing\$([\s\S]*?)\$klamath_pricing\$::jsonb/,
);
let migrationPricing;
try {
  migrationPricing = JSON.parse(pricingMatch?.[1] ?? "");
} catch (error) {
  errors.push(`migration pricing snapshot is invalid JSON: ${error.message}`);
}

function extractObjectLiteral(source, declaration) {
  const start = source.indexOf(declaration);
  if (start < 0) throw new Error(`missing declaration ${declaration}`);
  const open = source.indexOf("{", start);
  if (open < 0) throw new Error(`missing object for ${declaration}`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`unterminated object for ${declaration}`);
}

try {
  const literal = extractObjectLiteral(
    content.pricing ?? "",
    "export const BLULADDER_KLAMATH_PRICING_DRAFT",
  );
  const repositoryPricing = Function(
    `"use strict"; return (${literal});`,
  )();
  if (JSON.stringify(repositoryPricing) !== JSON.stringify(migrationPricing)) {
    errors.push("migration pricing snapshot drifted from the Phase 1A draft");
  }
} catch (error) {
  errors.push(`could not verify pricing parity: ${error.message}`);
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
  "applied inactive hosted foundation",
  "`20260814050336`",
  "one `provisioning`, non-default BluLadder Klamath organization",
  "runtime routing off, publication off, and customer traffic off",
  "creates no membership, contact destination, JobTread mapping",
  "Activation remains separately gated",
]) requireText("contract", text);

let register;
try {
  register = JSON.parse(content.register ?? "{}");
} catch (error) {
  errors.push(`Phase 1C gate register is invalid JSON: ${error.message}`);
}

if (register) {
  if (
    register.phase !== "1C" ||
    register.prepared_from_main !==
      "958157e215e039353629496316ba13623a5e9642" ||
    register.migration_version !== "20260813223348" ||
    register.canonical_hostname !== hostname
  ) errors.push("Phase 1C repository identity drifted");

  const requiredFalse = [
    "activation_allowed",
    "customer_traffic_allowed",
    "runtime_routing_enabled",
    "site_published",
    "hostname_resolution_key_enabled",
    "pricing_runtime_enabled",
    "contacts_configured",
    "memberships_configured",
    "provider_mappings_configured",
    "dfw_fallback_allowed",
  ];
  for (const key of requiredFalse) {
    if (register[key] !== false) errors.push(`${key} must remain false`);
  }
  if (
    register.migration_applied !== true ||
    register.hosted_organization_provisioned !== true ||
    register.hosted_execution_version !== "20260814050336" ||
    register.execution_receipt !== relative.receipt ||
    register.execution_receipt_sha256 !== receiptSha ||
    register.generated_types_sha256 !==
      "96881d6ca1b643e27256967eec97b9781dd264cbcf938779f03f71bcc85bc7dc"
  ) errors.push("Phase 1C hosted execution evidence drifted");
  if (
    register.lifecycle_after_application !== "provisioning" ||
    register.pricing_status !== "draft" ||
    register.migration_prepared !== true
  ) errors.push("Phase 1C inactive posture drifted");
  if (
    Object.values(register.authorized_actions ?? {}).some(
      (allowed) => allowed !== false,
    )
  ) errors.push("Phase 1C authorizes an out-of-scope action");
}

for (const text of [
  "collision rollback",
  "customer_traffic_allowed = true",
  "runtime_enabled = true",
  "SET ROLE authenticated",
  "REFERENCES",
  "TRIGGER",
  "TRUNCATE",
]) requireText("rehearsal", text);

for (const text of [
  "Authenticated must have exactly CRUD",
  "REFERENCES",
  "TRIGGER",
  "TRUNCATE",
]) requireText("verification", text);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  "BluLadder Klamath Phase 1C gate OK: the exact inactive hosted foundation and execution receipt remain reconciled, the additive hosted type lineage is exact, and every activation surface remains blocked.",
);
