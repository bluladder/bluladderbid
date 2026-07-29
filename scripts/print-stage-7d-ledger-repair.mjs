import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ledger = JSON.parse(
  await readFile(
    path.join(
      root,
      "docs",
      "operations",
      "tenant-stage-7d-migration-reconciliation.json",
    ),
    "utf8",
  ),
);

const shifted = ledger.entries.filter(
  ({ classification }) => classification === "applied but version/name differs",
);
const functionallyPresent = ledger.entries.filter(
  ({ classification }) =>
    classification === "functionally present but ledger provenance differs",
);
const superseded = ledger.entries.filter(
  ({ classification }) => classification === "superseded",
);

const revertedVersions = shifted.map(
  ({ likely_hosted_ledger_version }) => likely_hosted_ledger_version,
);
const appliedVersions = [
  ...shifted,
  ...functionallyPresent,
  ...superseded,
].map(({ repository_version }) => repository_version);

if (
  shifted.length !== 99 ||
  functionallyPresent.length !== 7 ||
  superseded.length !== 1
) {
  throw new Error(
    `Unexpected repair totals: shifted=${shifted.length}, functionally-present=${functionallyPresent.length}, superseded=${superseded.length}`,
  );
}

console.log(`#!/bin/sh
set -eu

# PROTECTED ACTION: this mutates only the hosted migration ledger.
# It does not apply or reverse schema SQL. Run only after explicit production
# authorization, a fresh read-only ledger export, and two-person review.
#
# Intentionally excluded:
# - hosted-only 20260128005316 (provenance decision still open)
# - Stage 7B, Stage 8A, and Stage 7D security migrations (genuinely pending)

supabase migration repair --linked --status reverted \\
  ${revertedVersions.join(" \\\n  ")}

supabase migration repair --linked --status applied \\
  ${appliedVersions.join(" \\\n  ")}

supabase migration list --linked
`);
