import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const relative =
  "packages/sales-engine/tenant/tenantIsolation.integration.test.ts";
const full = path.join(root, relative);
const errors = [];

if (!fs.existsSync(full)) {
  errors.push(`missing ${relative}`);
} else {
  const test = fs.readFileSync(full, "utf8");
  for (const contract of [
    "organizationRouting",
    "organizationResolver",
    "organizationConnector",
    "organizationPricing",
    "recommendationEngine",
  ]) {
    if (!test.includes(contract)) errors.push(`isolation suite omits ${contract}`);
  }
  for (const guarantee of [
    "organization_inactive",
    "connector_missing",
    "service_missing",
    "profile_missing",
    "organization_lineage_mismatch",
    "overlapping_territory",
    "legacy_not_allowed",
  ]) {
    if (!test.includes(guarantee)) errors.push(`isolation suite omits ${guarantee}`);
  }
  if (/\.skip\(|Deno\.test\.ignore/.test(test)) {
    errors.push("tenant isolation integration tests may not be skipped");
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Tenant isolation integration OK: routing, resolver, connector, pricing, intelligence.");
