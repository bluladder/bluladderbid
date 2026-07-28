import fs from "node:fs";

const sqlFiles = [
  "supabase/preflight/tenant_stage_7c_core.sql",
  "supabase/preflight/tenant_stage_7c_optional.sql",
];
const forbidden = /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|call|do|copy)\b/i;

for (const file of sqlFiles) {
  const source = fs.readFileSync(file, "utf8");
  const statements = source
    .replace(/--.*$/gm, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    if (!/^(select|show|with|explain)\b/i.test(statement)) {
      throw new Error(`${file}: non-read-only statement prefix`);
    }
    if (forbidden.test(statement)) {
      throw new Error(`${file}: forbidden mutation keyword`);
    }
  }
}

const requiredArtifacts = [
  "docs/operations/tenant-stage-7c-hosted-preflight.md",
  "docs/operations/tenant-stage-7b-migration-runbook.md",
  "docs/operations/tenant-production-authorization-checklist.md",
  "supabase/verification/tenant_foundation_stage_7b.sql",
];
for (const file of requiredArtifacts) {
  if (!fs.existsSync(file)) throw new Error(`missing readiness artifact: ${file}`);
}

const runbook = fs.readFileSync(requiredArtifacts[1], "utf8");
for (const phrase of [
  "supabase db push --linked --dry-run",
  "supabase db push --linked",
  "Forward-safe rollback",
  "Post-migration verification",
]) {
  if (!runbook.includes(phrase)) throw new Error(`runbook missing: ${phrase}`);
}

console.log("tenant readiness check passed: 2 read-only SQL scripts, 3 operator artifacts");
