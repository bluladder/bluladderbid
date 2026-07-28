import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql";
const sql = fs.readFileSync(migrationPath, "utf8");
const inventory = JSON.parse(
  fs.readFileSync("docs/architecture/tenant-inventory.json", "utf8"),
);

const requiredFragments = [
  "CREATE TABLE IF NOT EXISTS public.organizations",
  "CREATE TABLE IF NOT EXISTS public.organization_memberships",
  "CREATE TABLE IF NOT EXISTS public.organization_resolution_keys",
  "b1addf00-0000-4000-8000-000000000001",
  "CREATE OR REPLACE FUNCTION public.is_organization_member",
  "CREATE OR REPLACE FUNCTION public.enforce_first_wave_organization_lineage",
  "AS RESTRICTIVE FOR ALL TO authenticated",
];

for (const fragment of requiredFragments) {
  if (!sql.includes(fragment)) throw new Error(`missing migration contract: ${fragment}`);
}

for (const table of inventory.stage7BFirstWaveTables) {
  if (
    !sql.includes(
      `ALTER TABLE public.${table} ADD COLUMN IF NOT EXISTS organization_id uuid;`,
    )
  ) {
    throw new Error(`${table} is missing an additive organization_id migration`);
  }
  if (
    !new RegExp(
      `UPDATE public\\.${table}[\\s\\S]*?WHERE organization_id IS NULL;`,
    ).test(sql)
  ) {
    throw new Error(`${table} is missing a null-only DFW backfill`);
  }
  if (
    new RegExp(
      `ALTER TABLE public\\.${table}[\\s\\S]{0,120}organization_id[^;]*NOT NULL`,
      "i",
    ).test(sql)
  ) {
    throw new Error(`${table} prematurely enforces organization_id NOT NULL`);
  }
}

if (/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(sql)) {
  throw new Error("destructive migration statement detected");
}
if (/organization_id\s+uuid\s+DEFAULT/i.test(sql)) {
  throw new Error("organization_id must not have an implicit database default");
}

const unresolved = ["big_job_settings", "eligibility_rules", "schedule_blocks"];
for (const table of unresolved) {
  if (new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN`, "i").test(sql)) {
    throw new Error(`provenance-gap table entered first wave: ${table}`);
  }
}

console.log(
  "tenant foundation check passed: 3 primitives, 4 first-wave tables, " +
  "nullable/null-only backfill, no destructive DDL",
);
