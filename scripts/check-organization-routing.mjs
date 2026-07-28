import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = path.join(
  root,
  "supabase/migrations/20260728070000_organization_routing_stage_8a.sql",
);
const modulePath = path.join(
  root,
  "supabase/functions/_shared/organizationRouting.ts",
);
const testPath = path.join(
  root,
  "supabase/functions/_shared/organizationRouting_test.ts",
);
const contractPath = path.join(
  root,
  "docs/architecture/organization-routing-stage-8a.md",
);
const verificationPath = path.join(
  root,
  "supabase/verification/organization_routing_stage_8a.sql",
);

const requiredFiles = [
  migrationPath,
  modulePath,
  testPath,
  contractPath,
  verificationPath,
];
const errors = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) errors.push(`missing ${path.relative(root, file)}`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const migration = fs.readFileSync(migrationPath, "utf8");
const implementation = fs.readFileSync(modulePath, "utf8");
const tests = fs.readFileSync(testPath, "utf8");
const verification = fs.readFileSync(verificationPath, "utf8");

for (const table of [
  "organization_settings",
  "organization_contacts",
  "organization_territories",
  "organization_services",
]) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`)) {
    errors.push(`migration does not create ${table}`);
  }
  if (!migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)) {
    errors.push(`RLS is not enabled for ${table}`);
  }
  if (!verification.includes(`'${table}'`)) {
    errors.push(`verification omits ${table}`);
  }
}

if (
  !migration.includes("'bluladder-oregon-test'") ||
  !migration.includes("'provisioning'") ||
  !migration.includes("'Oregon test fixture — inactive'") ||
  !migration.includes("'inactive'")
) {
  errors.push("Oregon fixture is missing or not explicitly inactive");
}
if (/bluladder-oregon-test[\s\S]{0,300}'active'/i.test(migration)) {
  errors.push("Oregon organization fixture appears active");
}
if (
  !implementation.includes('reason: "unknown_territory"') ||
  !implementation.includes('reason: "overlapping_territory"') ||
  !implementation.includes('reason: "conflicting_rules"')
) {
  errors.push("routing implementation lacks explicit fail-closed states");
}
if (/fallback.{0,80}DFW|DFW.{0,80}fallback/is.test(implementation)) {
  errors.push("routing implementation appears to contain a DFW fallback");
}
for (const phrase of [
  "DFW compatibility",
  "equal-rank organizations are ambiguous",
  "exclusion",
  "inactive Oregon",
  "never fall back to DFW",
  "organization-isolated",
]) {
  if (!tests.includes(phrase)) errors.push(`tests omit: ${phrase}`);
}
if (/\b(DROP TABLE|TRUNCATE|DELETE FROM)\b/i.test(migration)) {
  errors.push("migration contains a destructive table/data operation");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Organization routing contract OK: 4 tables, inactive Oregon, fail-closed routing.");

