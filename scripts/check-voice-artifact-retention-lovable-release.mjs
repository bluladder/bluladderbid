import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { validateVoiceRetentionLovableEvidence } from "./validate-voice-artifact-retention-lovable-evidence.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => {
  throw new Error(`Voice retention Lovable release: ${message}`);
};
const requireFragments = (source, label, fragments) => {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) fail(`${label} omits ${fragment}`);
  }
};
const assertIdentity = (value, expected, label) => {
  if (
    sha256(value) !== (expected.sha256 ?? expected.file_sha256) ||
    Buffer.byteLength(value) !== expected.bytes
  ) {
    fail(`${label} identity changed`);
  }
};

const manifest = JSON.parse(
  await read("docs/releases/voice-artifact-retention-lovable-v1/release.json"),
);
const [
  source,
  control,
  artifact,
  preflightText,
  postflight,
  postflightMcpText,
  runbook,
  readme,
  controlEvidence,
  evidenceTemplateText,
  workflows,
  rehearsal,
] = await Promise.all([
  read(manifest.canonical_source.path),
  read(manifest.control_template.path),
  read(manifest.artifact.path),
  read(manifest.preflight.mcp_path),
  read(manifest.postflight.path),
  read(manifest.postflight.mcp_path),
  read(manifest.runbook),
  read(manifest.readme),
  read(manifest.control_plane_evidence),
  read(manifest.evidence.template),
  read(".github/workflows/ci.yml"),
  read("scripts/rehearse-voice-artifact-retention-lovable-postgres.sh"),
]);
const preflight = JSON.parse(preflightText);
const postflightMcp = JSON.parse(postflightMcpText);
const evidenceTemplate = JSON.parse(evidenceTemplateText);

if (
  manifest.status !== "CONTROL_PATH_PROVEN_NOT_AUTHORIZED" ||
  manifest.hosted_mutation_authorized !== false ||
  manifest.production_control_plane !== "lovable_cloud"
) {
  fail("authorization boundary changed");
}
if (
  manifest.source_commit !== "27bad0cd0e5053cfb436752bee0976c5e1278fd8" ||
  manifest.canonical_source.version !== "20260802043233"
) {
  fail("canonical source commit or version changed");
}
assertIdentity(source, manifest.canonical_source, "canonical source");
if (
  manifest.canonical_source.sha256 !==
    "a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102" ||
  manifest.canonical_source.git_blob !==
    "1ea2469315b0608df263a16611c7863beaec5ec3" ||
  !manifest.canonical_source.remains_active_for_clean_rebuild
) {
  fail("canonical source authority changed");
}
assertIdentity(control, manifest.control_template, "control template");
assertIdentity(artifact, manifest.artifact, "Lovable artifact");

const canonicalizedArtifact = artifact.replace(
  manifest.artifact.canonical_sha256,
  "__ARTIFACT_SHA256__",
);
if (sha256(canonicalizedArtifact) !== manifest.artifact.canonical_sha256) {
  fail("canonicalized artifact identity changed");
}
if (
  !artifact.includes(source) ||
  artifact.indexOf(source) !== artifact.lastIndexOf(source)
) {
  fail("canonical source is not embedded byte-for-byte exactly once");
}
if ((artifact.match(/^BEGIN;$/gm) ?? []).length !== 1) {
  fail("artifact must contain one explicit BEGIN");
}
if ((artifact.match(/^COMMIT;$/gm) ?? []).length !== 1) {
  fail("artifact must contain one terminal COMMIT");
}
if (!artifact.endsWith("COMMIT;\n")) {
  fail("artifact transaction is not terminal");
}
if (
  /__(?:CANONICAL_SQL|SOURCE_SHA256|CONTROL_SHA256|ARTIFACT_SHA256)__/.test(
    artifact,
  )
) {
  fail("artifact contains an unresolved assembler token");
}
for (
  const token of [
    "__CANONICAL_SQL__",
    "__SOURCE_SHA256__",
    "__CONTROL_SHA256__",
    "__ARTIFACT_SHA256__",
  ]
) {
  if ((control.match(new RegExp(token, "g")) ?? []).length !== 1) {
    fail(`control template must contain one ${token}`);
  }
}
requireFragments(artifact, "artifact", [
  "WHERE version = '20260128005316'",
  "WHERE version = '20260802043233'",
  "production history nor clean rebuild is proven",
  "partial voice retention state exists before release",
  "hosted migration baseline changed after preflight",
  "private schema unexpectedly predates retention release",
  "chat message deletion has unreviewed side effects",
  "private schema contains an unexpected object set",
  "voice retention scheduler authority differs",
  "clean rebuild retention state is incomplete",
  "voice-artifact-retention-lovable-v1",
  manifest.canonical_source.sha256,
  manifest.control_template.sha256,
  manifest.artifact.canonical_sha256,
  manifest.environment.project_ref,
  "tenant_security.release_provenance",
]);

const acceptedPayloads = manifest.artifact.accepted_ledger_payloads;
if (
  acceptedPayloads.length !== 2 ||
  acceptedPayloads[0].normalization !== "none" ||
  acceptedPayloads[0].sha256 !== sha256(artifact) ||
  acceptedPayloads[0].bytes !== Buffer.byteLength(artifact) ||
  acceptedPayloads[1].normalization !== "remove exactly one terminal LF" ||
  acceptedPayloads[1].sha256 !== sha256(artifact.slice(0, -1)) ||
  acceptedPayloads[1].bytes !== Buffer.byteLength(artifact.slice(0, -1))
) {
  fail("accepted Lovable ledger normalization changed");
}

for (
  const [label, text, expected] of [
    ["preflight MCP", preflightText, { sha256: manifest.preflight.mcp_sha256 }],
    ["postflight", postflight, { sha256: manifest.postflight.sha256 }],
    [
      "postflight MCP",
      postflightMcpText,
      { sha256: manifest.postflight.mcp_sha256 },
    ],
  ]
) {
  if (sha256(text) !== expected.sha256) fail(`${label} hash changed`);
}
for (
  const [label, suite, expectedCount] of [
    ["preflight MCP", preflight, 8],
    ["postflight MCP", postflightMcp, 6],
  ]
) {
  if (
    suite.submission_contract !==
      "one read-only SELECT statement per lovable query_database call" ||
    suite.project_id !== manifest.environment.lovable_project_id ||
    suite.project_ref !== manifest.environment.project_ref ||
    suite.environment !== manifest.environment.name ||
    suite.queries.length !== expectedCount
  ) {
    fail(`${label} identity or query count changed`);
  }
  for (const query of suite.queries) {
    const sql = query.sql.trim();
    const withoutStrings = sql.replace(/'(?:''|[^'])*'/g, "''");
    if (
      !/^SELECT\b/i.test(sql) ||
      /;\s*\S/.test(withoutStrings) ||
      /--|\/\*|\$[A-Za-z_0-9]*\$/.test(withoutStrings) ||
      /\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i
        .test(
          withoutStrings,
        )
    ) {
      fail(`${label} query ${query.id} is not one read-only SELECT`);
    }
  }
}

if (
  evidenceTemplate.fixture !== false ||
  evidenceTemplate.preflight?.status !== "PENDING" ||
  evidenceTemplate.execution?.status !== "PENDING" ||
  evidenceTemplate.postflight?.status !== "PENDING" ||
  evidenceTemplate.failure?.disposition !== "PENDING"
) {
  fail("production evidence template is not an unreleased placeholder");
}
if (
  !/BEGIN TRANSACTION READ ONLY;/i.test(postflight) ||
  !/\bROLLBACK;/i.test(postflight)
) {
  fail("transaction postflight is not explicitly read-only");
}
const postflightWithoutCommentsAndStrings = postflight
  .replace(/--.*$/gm, "")
  .replace(/'(?:''|[^'])*'/g, "''");
if (
  /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
    postflightWithoutCommentsAndStrings,
  )
) {
  fail("transaction postflight contains a mutation token");
}
requireFragments(postflight, "postflight", [
  "3366d93be81fb4d5056a93d91a2474df380b3707124568b2c6fc5f1a19f70d0d",
  acceptedPayloads[0].sha256,
  acceptedPayloads[1].sha256,
  "exact_new_payload_rows",
  "matching_provenance_rows",
  "canonical_source_version_rows",
  "execution_version_is_later",
]);

if (
  manifest.environment.hosted_ledger_count !== 151 ||
  manifest.environment.hosted_ledger_tip !== "20260801234014" ||
  manifest.environment.hosted_ledger_fingerprint_sha256 !==
    "3366d93be81fb4d5056a93d91a2474df380b3707124568b2c6fc5f1a19f70d0d" ||
  manifest.postflight.expected_ledger_count !== 152 ||
  manifest.postflight.expected_new_ledger_rows !== 1 ||
  manifest.postflight.expected_exact_payload_rows !== 1
) {
  fail("hosted ledger stop gates changed");
}

if (
  manifest.evidence.validator_version !==
    "voice-artifact-retention-lovable-evidence-v2" ||
  manifest.cli_safety.include_all_prohibited !== true ||
  manifest.cli_safety.migration_repair_prohibited !== true ||
  manifest.cli_safety.generated_migration_reconciliation_required !== true
) {
  fail("evidence validator version or CLI prohibition changed");
}
const replaySafety = manifest.replay_safety ?? {};
if (
  JSON.stringify(replaySafety.accepted_proof_modes) !==
    JSON.stringify([
      "supabase_cli_zero_selection_dry_run",
      "lovable_native_ledger_git_reconciliation",
    ]) ||
  replaySafety.lovable_native_requires_control_plane !== "lovable_cloud" ||
  replaySafety.expected_reconciled_ledger_count !==
    manifest.postflight.expected_ledger_count ||
  replaySafety.supabase_cli_claim_prohibited_for_lovable_native !== true
) {
  fail("replay-safety proof contract changed");
}

requireFragments(runbook, "runbook", [
  "Do not retry",
  "supabase db push --include-all",
  "supabase migration repair",
  manifest.artifact.file_sha256,
  manifest.environment.lovable_project_id,
  manifest.environment.project_ref,
  "Exact one-step production authorization",
  "supabase_cli_zero_selection_dry_run",
  "lovable_native_ledger_git_reconciliation",
  "retained_pre_execution",
]);
if (!/dry-run must select\s+nothing/i.test(runbook)) {
  fail("runbook does not require a zero-migration CLI dry-run");
}
requireFragments(readme, "README", [
  "caller-supplied migration version",
  "execution-time",
  "Git integration",
  "No production mutation",
]);
requireFragments(controlEvidence, "control-plane evidence", [
  "151",
  manifest.environment.hosted_ledger_tip,
  "3366…",
  "description",
  "query",
  "Option (c)",
]);
requireFragments(rehearsal, "PostgreSQL rehearsal", [
  "synthetic pre-commit failure",
  "partial release state survived transaction rollback",
  "hosted canonical-version conflict was not rejected",
  "partial target object was not rejected",
  "second Lovable artifact execution was not rejected",
  "canonical clean rebuild",
  "normalized Lovable ledger payload differs",
  "voice_artifact_retention_lovable_postflight.sql",
]);

if (
  /supabase\s+(?:db\s+push|migration\s+(?:up|repair))[^\n]*--include-all/i.test(
    workflows,
  ) ||
  /supabase\s+migration\s+repair/i.test(workflows)
) {
  fail("GitHub Actions can replay or repair historical migrations");
}

const migrationDirectory = resolve(root, "supabase/migrations");
const generatedCandidates = [];
const migrationVersions = new Map();
for (const file of await readdir(migrationDirectory)) {
  if (!file.endsWith(".sql")) continue;
  const migrationVersion = file.match(/^([0-9]{14})_/)?.[1];
  if (!migrationVersion) {
    fail(`migration filename has no 14-digit version: ${file}`);
  }
  if (migrationVersions.has(migrationVersion)) {
    fail(
      `migration version collision: ${migrationVersion} is used by ` +
        `${migrationVersions.get(migrationVersion)} and ${file}`,
    );
  }
  migrationVersions.set(migrationVersion, file);
  if (file === basename(manifest.canonical_source.path)) continue;
  const value = await readFile(resolve(migrationDirectory, file), "utf8");
  if (value.includes(manifest.release_id)) {
    generatedCandidates.push([file, value]);
  }
}
if (generatedCandidates.length > 1) {
  fail("more than one Lovable-generated migration contains this release ID");
}
const completedEvidencePath = resolve(root, manifest.evidence.completed_path);
let completedEvidence;
try {
  completedEvidence = JSON.parse(await readFile(completedEvidencePath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") fail("completed evidence is unreadable");
}

if (generatedCandidates.length === 0 && completedEvidence !== undefined) {
  fail("completed production evidence exists before the Lovable receipt");
}
if (generatedCandidates.length === 1) {
  const [file, value] = generatedCandidates[0];
  const version = file.match(/^([0-9]{14})_/i)?.[1];
  if (!version || version <= manifest.canonical_source.version) {
    fail("generated Lovable migration is not later than the canonical source");
  }
  if (value !== artifact && value !== artifact.slice(0, -1)) {
    fail("generated Lovable migration differs from the approved artifact");
  }
  if (completedEvidence === undefined) {
    fail("Lovable receipt exists without completed production evidence");
  }
  validateVoiceRetentionLovableEvidence(completedEvidence, manifest);
  const generated = completedEvidence.generated_migration;
  if (
    generated.path !== `supabase/migrations/${file}` ||
    generated.version !== version
  ) {
    fail("completed evidence points at a different generated migration");
  }

  let author;
  let changedEntries;
  let committedValue;
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", generated.commit_sha, "HEAD"],
      { cwd: root, stdio: "ignore" },
    );
    author = execFileSync(
      "git",
      ["show", "-s", "--format=%an <%ae>", generated.commit_sha],
      { cwd: root, encoding: "utf8" },
    ).trim();
    changedEntries = execFileSync(
      "git",
      [
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-status",
        "-r",
        generated.commit_sha,
      ],
      { cwd: root, encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    committedValue = execFileSync(
      "git",
      ["show", `${generated.commit_sha}:${generated.path}`],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
  } catch {
    fail("generated migration commit is not a reachable Git receipt");
  }
  if (
    author !==
      "gpt-engineer-app[bot] <159125892+gpt-engineer-app[bot]@users.noreply.github.com>"
  ) {
    fail(
      "generated migration was not introduced by the established Lovable bot",
    );
  }
  if (
    changedEntries.length !== 1 ||
    changedEntries[0] !== `A\t${generated.path}` ||
    committedValue !== value
  ) {
    fail("Lovable Git receipt path, scope, or committed bytes differ");
  }
}

if (
  !workflows.includes("check:voice-artifact-retention-lovable-release") ||
  !workflows.includes("github.event.pull_request.head.sha || github.sha")
) {
  fail("exact-head CI omits the Lovable release contract");
}

console.log(
  "Voice artifact retention Lovable release passed: canonical source, " +
    "atomic wrapper, exact ledger reconciliation, provenance, CLI replay " +
    "guard, privacy-safe pre/postflight, and authorization boundary are pinned.",
);
