import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const inventoryPath = path.join(root, "docs/architecture/tenant-inventory.json");
const typesPath = path.join(root, "src/integrations/supabase/types.ts");
const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
const types = fs.readFileSync(typesPath, "utf8");

function generatedNames(section, nextSection) {
  const start = types.indexOf(`    ${section}: {`);
  const end = types.indexOf(`\n    ${nextSection}: {`, start);
  if (start < 0 || end < 0) throw new Error(`Cannot locate generated ${section}`);
  return [...types.slice(start, end).matchAll(/^      ([A-Za-z_][A-Za-z0-9_]*): \{/gm)]
    .map((match) => match[1])
    .sort();
}

function classifiedNames(groups) {
  return Object.values(groups).flat().sort();
}

function assertExact(label, actual, expected) {
  const duplicates = expected.filter((name, index) => expected.indexOf(name) !== index);
  const missing = actual.filter((name) => !expected.includes(name));
  const stale = expected.filter((name) => !actual.includes(name));
  if (duplicates.length || missing.length || stale.length) {
    throw new Error(
      `${label} mismatch\n` +
      `duplicates: ${[...new Set(duplicates)].join(", ") || "none"}\n` +
      `missing: ${missing.join(", ") || "none"}\n` +
      `stale: ${stale.join(", ") || "none"}`,
    );
  }
}

const tables = generatedNames("Tables", "Views");
const views = generatedNames("Views", "Functions");
const functions = generatedNames("Functions", "Enums");

assertExact("tables", tables, classifiedNames(inventory.tables));
assertExact("views", views, classifiedNames(inventory.views));
assertExact("database functions", functions, classifiedNames(inventory.databaseFunctions));

const migrationDir = path.join(root, "supabase/migrations");
const migrationText = fs.readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => fs.readFileSync(path.join(migrationDir, name), "utf8"))
  .join("\n");

if (/\b(?:organization_id|tenant_id)\b/i.test(migrationText)) {
  throw new Error("Stage 7A baseline changed: tenant columns now exist in migration history");
}

const edgeRoot = path.join(root, "supabase/functions");
const edgeFunctions = fs.readdirSync(edgeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .filter((entry) => fs.existsSync(path.join(edgeRoot, entry.name, "index.ts")));
if (edgeFunctions.length !== inventory.runtime.edgeFunctionCount) {
  throw new Error(
    `edge function count changed: expected ${inventory.runtime.edgeFunctionCount}, found ${edgeFunctions.length}`,
  );
}

console.log(
  `tenant inventory check passed: ${tables.length} tables, ${views.length} views, ` +
  `${functions.length} database functions, ${edgeFunctions.length} edge functions`,
);
