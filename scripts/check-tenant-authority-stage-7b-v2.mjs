import fs from "node:fs";
import { execFileSync } from "node:child_process";

const migrationPath =
  "supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
const baseline = "388d9849a9bfa187faa8122e82b37ef4965b2364";
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const secretScanWorkflow = fs.readFileSync(
  ".github/workflows/secret-scan.yml",
  "utf8",
);

for (const fragment of [
  "ADD COLUMN IF NOT EXISTS organization_id uuid",
  "IN SHARE ROW EXCLUSIVE MODE",
  "quote_sessions_organization_id_fkey",
  "chat_conversations_organization_id_fkey",
  "quote_sessions_organization_id_idx",
  "chat_conversations_organization_id_idx",
  "VALIDATE CONSTRAINT quote_sessions_organization_id_fkey",
  "VALIDATE CONSTRAINT chat_conversations_organization_id_fkey",
  "first-wave quote organization reconciliation required",
  "first-wave booking organization reconciliation required",
  "quote session organization backfill conflict",
  "conversation organization backfill conflict",
  "enforce_first_wave_organization_lineage",
  "enforce_session_organization_lineage",
  "old-runtime/new-schema transition",
  'CREATE POLICY "Tenant boundary quote sessions"',
  'CREATE POLICY "Tenant boundary chat conversations"',
  "AS RESTRICTIVE FOR ALL TO authenticated",
  "WITH CHECK",
  "security_invoker = true",
  "REVOKE ALL ON public.quote_sessions, public.chat_conversations",
]) {
  if (!migration.includes(fragment)) {
    throw new Error(`Stage 7B v2 migration omits: ${fragment}`);
  }
}

if (/organization_id\s+uuid\s+DEFAULT/i.test(migration)) {
  throw new Error("Stage 7B v2 must not install an organization default");
}
if (/UPDATE[\s\S]{0,160}organization_id\s*=\s*['\"]b1addf00/i.test(migration)) {
  throw new Error("Stage 7B v2 must not blanket-backfill DFW");
}
if (/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(migration)) {
  throw new Error("Stage 7B v2 contains destructive DDL");
}
if (/SECURITY\s+DEFINER/i.test(migration)) {
  throw new Error("Stage 7B v2 must not add a security-definer function");
}

// PR #65 is intentionally schema preparation only. A GitHub merge syncs main
// back into Lovable development/preview, while Edge publication ordering is
// not a documented atomic contract with database migration application. Keep
// every Edge source and test byte-identical to the pre-PR baseline. Checking
// the complete tree also catches a newly added runtime file that an allowlist
// could overlook.
const changedEdgePaths = execFileSync(
  "git",
  ["diff", "--name-only", baseline, "--", "supabase/functions"],
  { encoding: "utf8" },
).trim();
if (changedEdgePaths) {
  throw new Error(
    `schema-only release boundary violated by Edge changes:\n${changedEdgePaths}`,
  );
}

// CI must exercise the published PR head, not GitHub's synthetic merge tree.
const exactHeadCheckout = "github.event.pull_request.head.sha || github.sha";
if (
  !ciWorkflow.includes(exactHeadCheckout) ||
  !secretScanWorkflow.includes(exactHeadCheckout)
) {
  throw new Error("CI or secret scan does not checkout the exact PR head");
}

// Repository automation may rehearse migrations, but it may not publish or
// apply them. Lovable synchronization is therefore treated as an external
// release boundary, never as an ordering guarantee.
for (const forbidden of [
  /supabase\s+db\s+push/i,
  /supabase\s+functions\s+deploy/i,
  /supabase\s+migration\s+up/i,
  /vercel\s+(?:deploy|--prod)/i,
  /lovable[_ -]deploy/i,
]) {
  if (forbidden.test(`${ciWorkflow}\n${secretScanWorkflow}`)) {
    throw new Error(`automatic release command entered GitHub Actions: ${forbidden}`);
  }
}

console.log(
  "Stage 7B v2 schema-preparation check passed: additive session scope, " +
    "parent-only derivation, restrictive RLS, explicit grants, and all " +
    "production runtime consumers byte-identical to baseline.",
);
