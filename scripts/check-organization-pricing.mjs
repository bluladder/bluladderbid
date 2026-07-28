import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract: "packages/sales-engine/pricing/organizationPricing.ts",
  tests: "packages/sales-engine/pricing/organizationPricing.test.ts",
  docs: "docs/architecture/organization-pricing-stage-10a.md",
};
const errors = [];
const contents = {};

for (const [name, relative] of Object.entries(files)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    errors.push(`missing ${relative}`);
  } else {
    contents[name] = fs.readFileSync(full, "utf8");
  }
}

for (const strategy of [
  "square_footage",
  "window_count",
  "pane_count",
  "manual_quote",
  "promotional_package",
  "hybrid",
]) {
  if (!contents.contract?.includes(`"${strategy}"`)) {
    errors.push(`pricing contract omits ${strategy}`);
  }
}

for (const failure of [
  "service_missing",
  "service_ambiguous",
  "service_disabled",
  "service_unapproved",
  "inputs_unsupported",
  "profile_missing",
  "profile_ambiguous",
  "profile_unapproved",
  "organization_lineage_mismatch",
]) {
  if (!contents.contract?.includes(`"${failure}"`)) {
    errors.push(`pricing contract omits fail-closed state ${failure}`);
  }
}

if (!contents.tests?.includes("reproduces the current DFW canonical quote exactly")) {
  errors.push("pricing tests omit exact DFW parity");
}
if (!contents.tests?.includes("inactive Oregon has no implicit DFW profile")) {
  errors.push("pricing tests omit inactive Oregon isolation");
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("pricing tests may not be skipped");
}
if (!contents.docs?.includes("There is no DFW fallback")) {
  errors.push("documentation must prohibit DFW pricing fallback");
}
if (!contents.docs?.includes("AI may suggest")) {
  errors.push("documentation must keep AI pricing advisory");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Organization pricing contract OK: 6 strategies, fail-closed selection, exact DFW parity.");
