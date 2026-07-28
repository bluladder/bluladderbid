import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  contract: "supabase/functions/_shared/connectorContracts.ts",
  selection: "supabase/functions/_shared/organizationConnector.ts",
  adapter: "supabase/functions/_shared/jobberConnectorAdapter.ts",
  tests: "supabase/functions/_shared/organizationConnector_test.ts",
  docs: "docs/architecture/organization-connectors-stage-9a.md",
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

for (const capability of [
  "customer_sync",
  "quote_sync",
  "availability_read",
  "booking_create",
  "booking_update",
  "booking_cancel",
  "invoice_handoff",
  "communications_handoff",
  "health",
]) {
  if (!contents.contract?.includes(`"${capability}"`)) {
    errors.push(`connector contract omits ${capability}`);
  }
}

for (const failure of [
  "connector_missing",
  "connector_ambiguous",
  "connector_inactive",
  "capability_unsupported",
  "credential_reference_missing",
  "organization_lineage_mismatch",
  "idempotency_key_missing",
]) {
  if (
    !contents.contract?.includes(`"${failure}"`) &&
    !contents.selection?.includes(`"${failure}"`)
  ) {
    errors.push(`connector contract omits fail-closed state ${failure}`);
  }
}

if (!contents.docs?.includes("There is no DFW fallback")) {
  errors.push("documentation must prohibit DFW connector fallback");
}
if (!contents.docs?.includes("Oregon connector configuration and traffic remain inactive")) {
  errors.push("documentation must keep Oregon inactive");
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("connector tests may not be skipped");
}
if (!contents.adapter?.includes("guardConnectorRequest")) {
  errors.push("Jobber adapter lacks lineage/idempotency guard");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("Organization connector contract OK: 9 capabilities, fail-closed selection, guarded Jobber seam.");

