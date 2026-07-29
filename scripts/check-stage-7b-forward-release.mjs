import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const fail = (message) => {
  throw new Error(message);
};
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const gitRaw = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const release = JSON.parse(
  await read("docs/releases/stage-7b-forward/release.json"),
);
const effects = JSON.parse(
  await read("docs/releases/stage-7b-forward/expected-effects.json"),
);
const releaseDir = path.join(root, "docs/releases/stage-7b-forward");
const releaseFiles = await readdir(releaseDir);

if (release.decision !== "NO-GO") fail("Release must remain NO-GO");
if (release.environment.project_ref !== "gyndziiuizpgwhqwyrvn") {
  fail("Wrong production project ref");
}
if (!release.environment.rejected_project_refs.includes("fqyplaphuafbtalrxqzd")) {
  fail("Known wrong project is not rejected");
}
if (release.execution.selected_mechanism !== null) {
  fail("Execution mechanism cannot be selected while blockers remain");
}
if (
  release.execution.ledger_rewrite_allowed ||
  release.execution.hosted_mutation_authorized
) {
  fail("Repository package cannot authorize hosted mutation");
}
if (release.allowlist.migration_paths.length !== 1) {
  fail("Release must allow exactly one migration");
}
if (releaseFiles.some((filename) => filename.endsWith(".sql"))) {
  fail("Release docs directory must not contain an unguarded SQL copy");
}

const sourceCommit = git("rev-parse", `${release.source.commit}^{commit}`);
if (sourceCommit !== release.source.commit) fail("Immutable source commit changed");
const sourceSql = gitRaw("show", `${sourceCommit}:${release.source.path}`);
if (Buffer.byteLength(sourceSql) !== release.source.bytes) {
  fail("Immutable migration size changed");
}
if (sha256(sourceSql) !== release.source.sha256) {
  fail("Immutable migration SHA-256 changed");
}
if (
  git("rev-parse", `${sourceCommit}:${release.source.path}`) !==
  release.source.git_blob
) {
  fail("Immutable migration Git blob changed");
}
const currentSql = await read(release.source.path);
if (sha256(currentSql) !== release.source.sha256) {
  fail("Tracked Stage 7B SQL differs from the immutable release");
}
if (
  release.allowlist.excluded_versions.some((version) =>
    release.allowlist.migration_paths.some((filename) =>
      filename.includes(version),
    ),
  )
) {
  fail("A deferred migration entered the allowlist");
}
if (release.expected_existing_rows.first_wave_total !== 30) {
  fail("Expected first-wave impact changed");
}
if (
  Object.values(effects.backfills)
    .filter((value) => Number.isInteger(value))
    .reduce((total, value) => total + value, 0) !== 30
) {
  fail("Backfill impact does not total 30 rows");
}

const [preflight, provenance, readme, mechanisms] = await Promise.all([
  read("supabase/preflight/tenant_stage_7b_forward_release.sql"),
  read("supabase/verification/legacy_hosted_provenance_baseline.sql"),
  read("docs/releases/stage-7b-forward/README.md"),
  read("docs/releases/stage-7b-forward/execution-mechanisms.md"),
]);
for (const [name, sql] of [
  ["Stage 7B preflight", preflight],
  ["legacy provenance baseline", provenance],
]) {
  if (
    !/BEGIN TRANSACTION READ ONLY;/i.test(sql) ||
    !/\bROLLBACK;/i.test(sql)
  ) {
    fail(`${name} is not transaction-enforced read-only`);
  }
  if (
    /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
      sql.replace(/--.*$/gm, ""),
    )
  ) {
    fail(`${name} contains a mutation token`);
  }
}
for (const required of [
  "infinite recursion detected in policy",
  "NO-GO",
  "apply_migration",
  "20260728060000",
]) {
  if (!`${readme}\n${mechanisms}`.includes(required)) {
    fail(`Release decision is missing ${required}`);
  }
}

console.log(
  "Stage 7B forward release valid: immutable 12,135-byte payload, one-file " +
    "allowlist, 30-row impact, read-only baselines, unresolved blockers, NO-GO.",
);
