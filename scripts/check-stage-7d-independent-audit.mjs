import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const fail = (message) => {
  throw new Error(message);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const [auditText, reconciliationText, gate, independentReport, migration, printer] =
  await Promise.all([
    read("docs/operations/tenant-stage-7d-independent-audit.json"),
    read("docs/operations/tenant-stage-7d-migration-reconciliation.json"),
    read("docs/operations/tenant-stage-7d-migration-gate.md"),
    read("docs/operations/tenant-stage-7d-independent-audit.md"),
    read("supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql"),
    read("scripts/print-stage-7d-ledger-repair.mjs"),
  ]);

const audit = JSON.parse(auditText);
if (audit.decision !== "NO-GO") fail("Independent decision must remain NO-GO");
if (audit.project_ref !== "gyndziiuizpgwhqwyrvn") {
  fail("Wrong production project ref");
}
if (!audit.rejected_project_refs.includes("fqyplaphuafbtalrxqzd")) {
  fail("Known wrong project is not rejected");
}
if (audit.supabase_cli.version !== "2.101.0") {
  fail("Supabase CLI version pin changed without review");
}
if (!audit.supabase_cli.forbidden_flags.includes("--include-all")) {
  fail("--include-all must remain forbidden");
}
if (audit.release.stage_7b_commit !== "bb96ec9") {
  fail("Stage 7B immutable release commit changed");
}
if (sha256(migration) !== audit.release.allowed_migration.sha256) {
  fail("Stage 7B migration hash changed");
}
if (sha256(reconciliationText) !== audit.ledger.reconciliation_sha256) {
  fail("Reconciliation manifest changed without independent review");
}
if (
  audit.ledger.repair_manifest.reverted.length !== 0 ||
  audit.ledger.repair_manifest.applied.length !== 0
) {
  fail("Audited ledger repair manifest must contain zero actions");
}
if (
  audit.admission.ledger_mutations_authorized ||
  audit.admission.hosted_schema_mutations_authorized
) {
  fail("Repository audit must not authorize hosted mutation");
}
if (!printer.includes("bulk ledger repair is disabled")) {
  fail("Bulk ledger repair generator is not fail-closed");
}
if (/UPDATE\s+cron\.job\s+SET\b/i.test(`${gate}\n${independentReport}`)) {
  fail("Unsupported direct cron.job update found in an operative runbook");
}
for (const required of [
  "cron.alter_job",
  "bb96ec9",
  "2.101.0",
  "NO-GO",
  "zero-action repair manifest",
]) {
  if (!`${gate}\n${independentReport}`.includes(required)) {
    fail(`Independent gate is missing ${required}`);
  }
}

function validateProposedCommand(command) {
  if (/(^|\s)--include-all(\s|$)/.test(command)) {
    fail("Forbidden --include-all flag");
  }
  if (/\bmigration\s+repair\b/.test(command)) {
    fail("Ledger repair is not authorized");
  }
  if (!/^supabase db push --linked --dry-run$/.test(command)) {
    fail("Command is not the exact audited dry-run command");
  }
}

function validateDryRun(output) {
  const migrationNames = [
    ...output.matchAll(/\b(\d{14}_[A-Za-z0-9_-]+\.sql)\b/g),
  ].map((match) => match[1]);
  const unique = [...new Set(migrationNames)];
  const expected = audit.admission.required_dry_run_selection;
  if (
    unique.length !== expected.length ||
    unique.some((filename, index) => filename !== expected[index])
  ) {
    fail(`Dry-run selection is not allowlisted: ${unique.join(", ") || "<none>"}`);
  }
  if (unique.includes(audit.never_replay.superseded_cleanup)) {
    fail("Superseded cleanup appeared in dry run");
  }
}

validateProposedCommand("supabase db push --linked --dry-run");
for (const forbidden of [
  "supabase db push --linked --dry-run --include-all",
  "supabase migration repair --linked --status applied 20260713051500",
  "supabase db push --linked",
]) {
  try {
    validateProposedCommand(forbidden);
    fail(`Guard accepted forbidden command: ${forbidden}`);
  } catch (error) {
    if (error.message.startsWith("Guard accepted")) throw error;
  }
}
validateDryRun("Would push migration 20260728060000_tenant_foundation_stage_7b.sql");
for (const forbiddenOutput of [
  "Would push migration 20260713051500_cleanup_geocode_verify_precheck.sql",
  "Would push migration 20260728070000_organization_routing_stage_8a.sql",
  "Database is up to date.",
]) {
  try {
    validateDryRun(forbiddenOutput);
    fail(`Guard accepted forbidden dry run: ${forbiddenOutput}`);
  } catch (error) {
    if (error.message.startsWith("Guard accepted")) throw error;
  }
}

console.log(
  "Stage 7D independent audit valid: zero ledger actions, CLI 2.101.0, " +
    "Stage 7B-only allowlist, destructive replay/project/manifest guards pass.",
);
