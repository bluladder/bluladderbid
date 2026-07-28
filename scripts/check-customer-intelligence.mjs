import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  features: "src/lib/customerIntelligence/featureBuilder.ts",
  recommendations: "src/lib/customerIntelligence/recommendationEngine.ts",
  featureTests: "src/lib/customerIntelligence/featureBuilder.test.ts",
  recommendationTests: "src/lib/customerIntelligence/recommendationEngine.test.ts",
  docs: "docs/customer-intelligence-phase-3.md",
};
const contents = {};
const errors = [];

for (const [name, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[name] = fs.readFileSync(full, "utf8");
}

for (const required of [
  "organizationId",
  "canonicalEventId",
  "valueSemantics",
  "featureVersion",
  "inputFingerprint",
  "archivedStatus",
  "duplicate_canonical_event",
  "organization_lineage_mismatch",
]) {
  if (
    !contents.features?.includes(required)
    && !contents.recommendations?.includes(required)
  ) errors.push(`customer intelligence contract omits ${required}`);
}

for (const required of [
  "model_unapproved",
  "model_lineage_mismatch",
  "OrganizationServiceCatalogEntry",
  "RECENT_COMPLAINT_SUPPRESSION",
  "ARCHIVED_CLIENT_EXCLUDED",
]) {
  if (!contents.recommendations?.includes(required)) {
    errors.push(`recommendation contract omits ${required}`);
  }
}

if (!contents.docs?.includes("There is no DFW fallback")) {
  errors.push("documentation must prohibit DFW fallback");
}
if (!/Oregon has no imported\s+history/.test(contents.docs ?? "")) {
  errors.push("documentation must keep Oregon inactive");
}
if (
  /Deno\.test\.ignore|\.skip\(/.test(
    `${contents.featureTests ?? ""}${contents.recommendationTests ?? ""}`,
  )
) errors.push("customer intelligence tests may not be skipped");

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Customer intelligence contract OK: tenant lineage, provenance, catalog gating, bounded learning.");
