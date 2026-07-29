import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

const [
  reconciliationText,
  uniquenessText,
  gate,
  evidence,
  securityMigration,
  securityVerification,
  hostedPreflight,
] = await Promise.all([
  read("docs/operations/tenant-stage-7d-migration-reconciliation.json"),
  read("docs/architecture/tenant-stage-7d-uniqueness-classification.json"),
  read("docs/operations/tenant-stage-7d-migration-gate.md"),
  read("docs/operations/tenant-stage-7d-hosted-evidence.md"),
  read(
    "supabase/migrations/20260728080000_restrict_security_definer_execution.sql",
  ),
  read("supabase/verification/tenant_stage_7d_security_definer.sql"),
  read("supabase/preflight/tenant_stage_7d_reconciliation.sql"),
]);

const reconciliation = JSON.parse(reconciliationText);
const uniqueness = JSON.parse(uniquenessText);
const fail = (message) => {
  throw new Error(message);
};
const requireText = (source, needle, description) => {
  if (!source.includes(needle)) fail(`Missing ${description}: ${needle}`);
};

if (reconciliation.project_ref !== "gyndziiuizpgwhqwyrvn") {
  fail("Reconciliation project ref is not production");
}
if (
  reconciliation.baseline_repository_migration_count !== 154 ||
  reconciliation.branch_repository_migration_count !== 155 ||
  reconciliation.hosted_ledger_count !== 145
) {
  fail("Migration reconciliation totals changed");
}
if (
  reconciliation.unclaimed_hosted_ledger_entries.length !== 1 ||
  reconciliation.unclaimed_hosted_ledger_entries[0].version !== "20260128005316"
) {
  fail("Hosted-only provenance entry changed");
}
if (reconciliation.entries.some(({ classification }) => classification === "unresolved")) {
  fail("Reconciliation contains unresolved repository migrations");
}

const expectedClassifications = {
  "applied and ledger-aligned": 45,
  "applied but version/name differs": 99,
  "functionally present but ledger provenance differs": 7,
  "genuinely pending": 3,
  superseded: 1,
};
for (const [classification, count] of Object.entries(expectedClassifications)) {
  if (reconciliation.classifications[classification] !== count) {
    fail(`Unexpected ${classification} count`);
  }
}

for (const filename of [
  "20260727002000_customer_intelligence_phase2_attribution.sql",
  "20260727004500_persist_booking_lead_attribution.sql",
]) {
  const entry = reconciliation.entries.find(
    ({ repository_filename }) => repository_filename === filename,
  );
  if (
    !entry ||
    entry.classification !==
      "functionally present but ledger provenance differs" ||
    entry.matching_confidence !== "high" ||
    entry.replay_disposition !== "must not replay"
  ) {
    fail(`Missing proven no-replay classification for ${filename}`);
  }
}

const allowedUniquenessClasses = new Set([
  "intentionally platform-global",
  "organization-scoped composite key",
  "provider-scoped",
  "ambiguous and requiring decision",
  "safe for single-organization compatibility only",
]);
if (uniqueness.project_ref !== "gyndziiuizpgwhqwyrvn") {
  fail("Uniqueness ledger project ref is not production");
}
if (uniqueness.entries.length !== 65) {
  fail(`Expected 65 unique-index classifications, found ${uniqueness.entries.length}`);
}
if (
  new Set(uniqueness.entries.map(({ index }) => index)).size !==
  uniqueness.entries.length
) {
  fail("Uniqueness ledger contains duplicate index names");
}
for (const entry of uniqueness.entries) {
  if (!allowedUniquenessClasses.has(entry.classification)) {
    fail(`Unknown uniqueness classification for ${entry.index}`);
  }
  if (
    ["organization-scoped composite key", "provider-scoped"].includes(
      entry.classification,
    ) &&
    (!Array.isArray(entry.target_key) || entry.target_key.length < 2)
  ) {
    fail(`Scoped uniqueness entry lacks a composite target: ${entry.index}`);
  }
}
for (const requiredIndex of [
  "customers_email_key",
  "bookings_reference_number_key",
  "ux_properties_normalized_address",
  "quotes_idempotency_key_uidx",
  "attribution_events_source_session_id_key",
  "lead_source_sync_events_idempotency_key_key",
  "technicians_jobber_user_id_key",
  "test_identities_email_lower_uidx",
]) {
  if (!uniqueness.entries.some(({ index }) => index === requiredIndex)) {
    fail(`Required uniqueness decision missing: ${requiredIndex}`);
  }
}

for (const needle of [
  "NO-GO",
  "100 hosted versions",
  "110 branch-local versions",
  "20260728060000_tenant_foundation_stage_7b.sql",
  "supabase migration repair",
  "supabase db push --linked --dry-run",
  "WHERE jobid IN (3, 5, 6)",
  "SET active = false",
  "SET active = true",
  "Must never replay",
  "20260128005316",
]) {
  requireText(gate, needle, "migration-gate contract");
}
requireText(evidence, "transaction_read_only=on", "read-only evidence boundary");
requireText(evidence, "No customer rows, secrets", "credential evidence handling");

for (const signature of [
  "public.audit_business_knowledge()",
  "public.persist_booking_lead_attribution()",
  "public.search_published_business_knowledge(text, integer)",
]) {
  requireText(securityMigration, signature, "reviewed function signature");
}
requireText(
  securityMigration,
  "FROM PUBLIC, anon, authenticated, service_role",
  "trigger-function EXECUTE revocation",
);
requireText(
  securityMigration,
  "TO anon, authenticated, service_role",
  "explicit search RPC grants",
);
requireText(
  securityVerification,
  "BEGIN TRANSACTION READ ONLY",
  "read-only security verification",
);
requireText(securityVerification, "ROLLBACK;", "verification rollback");
requireText(
  hostedPreflight,
  "BEGIN TRANSACTION READ ONLY",
  "hosted preflight read-only transaction",
);
requireText(hostedPreflight, "ROLLBACK;", "hosted preflight rollback");
if (/select\s+[\s\S]{0,120}\bcommand\b\s*(,|\n|from)/i.test(hostedPreflight)) {
  fail("Hosted preflight may expose a complete cron command");
}

console.log(
  "Stage 7D migration gate valid: 154-main/155-branch migrations, 145 hosted ledger entries, 65 uniqueness decisions, security and runbook contracts present.",
);
