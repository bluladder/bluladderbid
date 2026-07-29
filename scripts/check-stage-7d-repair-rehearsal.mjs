import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => {
  throw new Error(message);
};
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const gitRaw = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const [auditText, reconciliationText] = await Promise.all([
  readFile(
    path.join(root, "docs/operations/tenant-stage-7d-independent-audit.json"),
    "utf8",
  ),
  readFile(
    path.join(
      root,
      "docs/operations/tenant-stage-7d-migration-reconciliation.json",
    ),
    "utf8",
  ),
]);
const audit = JSON.parse(auditText);
const reconciliation = JSON.parse(reconciliationText);

const releaseCommit = git("rev-parse", `${audit.release.stage_7b_commit}^{commit}`);
if (releaseCommit !== audit.release.stage_7b_full_commit) {
  fail("Stage 7B release commit is not immutable");
}
if (
  git("rev-parse", `${releaseCommit}:supabase/migrations`) !==
  audit.release.migration_git_tree
) {
  fail("Stage 7B migration tree changed");
}

const releaseFiles = git(
  "ls-tree",
  "-r",
  "--name-only",
  releaseCommit,
  "--",
  "supabase/migrations",
)
  .split("\n")
  .filter((filename) => filename.endsWith(".sql"));
if (releaseFiles.length !== audit.release.migration_count) {
  fail(`Expected ${audit.release.migration_count} release migrations`);
}
const localVersions = new Set(
  releaseFiles.map((filename) => path.basename(filename).slice(0, 14)),
);
const hostedVersions = new Set([
  ...reconciliation.entries
    .map(({ likely_hosted_ledger_version }) => likely_hosted_ledger_version)
    .filter(Boolean),
  ...reconciliation.unclaimed_hosted_ledger_entries.map(({ version }) => version),
]);
const difference = (left, right) => [...left].filter((value) => !right.has(value));
const baselineRemoteOnly = difference(hostedVersions, localVersions);
const baselineLocalOnly = difference(localVersions, hostedVersions);
if (baselineRemoteOnly.length !== 100 || baselineLocalOnly.length !== 108) {
  fail(
    `Baseline drift changed: remote=${baselineRemoteOnly.length}, ` +
      `local=${baselineLocalOnly.length}`,
  );
}
if (!baselineLocalOnly.includes("20260713051500")) {
  fail("--include-all rehearsal no longer exposes the superseded cleanup");
}

const shifted = reconciliation.entries.filter(
  ({ classification }) => classification === "applied but version/name differs",
);
const proposedReverts = shifted.map(
  ({ likely_hosted_ledger_version }) => likely_hosted_ledger_version,
);
const proposedApplies = reconciliation.entries
  .filter(({ classification }) =>
    [
      "applied but version/name differs",
      "functionally present but ledger provenance differs",
      "superseded",
    ].includes(classification),
  )
  .map(({ repository_version }) => repository_version);
if (proposedReverts.length !== 99 || proposedApplies.length !== 107) {
  fail("Rejected bulk-repair shape changed");
}
const hypotheticallyRepaired = new Set(hostedVersions);
for (const version of proposedReverts) hypotheticallyRepaired.delete(version);
for (const version of proposedApplies) hypotheticallyRepaired.add(version);
const repairedRemoteOnly = difference(hypotheticallyRepaired, localVersions);
const repairedLocalOnly = difference(localVersions, hypotheticallyRepaired);
if (
  repairedRemoteOnly.join() !== "20260128005316" ||
  repairedLocalOnly.join() !== "20260728060000"
) {
  fail("Rejected bulk repair no longer leaves the expected unresolved pair");
}

const migrationPath =
  "supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql";
const stage7b = gitRaw("show", `${releaseCommit}:${migrationPath}`);
if (sha256(stage7b) !== audit.release.allowed_migration.sha256) {
  fail("Stage 7B release blob hash changed");
}
const cleanupPath = releaseFiles.find((filename) =>
  filename.includes(audit.never_replay.superseded_cleanup),
);
if (!cleanupPath) fail("Superseded cleanup missing from release rehearsal");
const cleanup = gitRaw("show", `${releaseCommit}:${cleanupPath}`);
if (sha256(cleanup) !== audit.never_replay.superseded_cleanup_sha256) {
  fail("Superseded cleanup hash changed");
}

console.log(
  "Stage 7D disposable rehearsal valid: release=153, hosted=145, " +
    "baseline=100-remote/108-local, --include-all exposes cleanup, rejected " +
    "99/107 repair leaves hosted-only provenance plus Stage 7B.",
);
