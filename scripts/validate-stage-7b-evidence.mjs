import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[0-9a-f]{64}$/;
const GIT_OBJECT_ID = /^[0-9a-f]{40}$/;
const EXPECTED_CRON = new Map([
  [3, '1a1b5b332626f37867e3521d2052f56b'],
  [5, '88e143e3876903e839e7551f68dd179b'],
  [6, 'ad8c290523e2659a608e7fcb7d57bcb7'],
]);

function fail(message) {
  throw new Error(message);
}

function requireValue(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} is required`);
  }
}

function requireTimestamp(value, label) {
  requireValue(value, label);
  if (!Number.isFinite(Date.parse(value))) fail(`${label} is not an ISO timestamp`);
}

function requireSha(value, label) {
  if (!SHA256.test(value ?? '')) fail(`${label} is not a SHA-256`);
}

function requireGitObjectId(value, label) {
  if (!GIT_OBJECT_ID.test(value ?? '')) fail(`${label} is not a Git object ID`);
}

export function validateStage7bEvidence(
  evidence,
  release,
  { allowFixture = false } = {},
) {
  if (evidence.schema_version !== 1) fail('unsupported evidence schema');
  if (evidence.fixture && !allowFixture) fail('fixture evidence is not releasable');

  if (evidence.release?.release_id !== release.release_id) {
    fail('release identity mismatch');
  }
  for (const field of [
    'operator_identity',
    'independent_reviewer',
    'approval_record',
  ]) {
    requireValue(evidence.release?.[field], `release.${field}`);
  }

  const expectedArtifact = {
    source_commit: release.source.commit,
    source_git_blob: release.source.git_blob,
    source_sha256: release.source.sha256,
    correction_commit: release.correction.commit,
    correction_git_blob: release.correction.git_blob,
    correction_sha256: release.correction.sha256,
    provenance_git_blob: release.provenance.git_blob,
    provenance_sha256: release.provenance.sha256,
    candidate_sha256: release.assembled.sha256,
  };
  for (const [field, expected] of Object.entries(expectedArtifact)) {
    if (evidence.artifact?.[field] !== expected) {
      fail(`artifact.${field} mismatch`);
    }
  }
  requireGitObjectId(
    evidence.artifact?.provenance_commit,
    'artifact.provenance_commit',
  );
  if (evidence.artifact?.provenance_commit_contains_blob !== true) {
    fail('artifact.provenance_commit does not contain the pinned blob');
  }

  const identity = evidence.identity ?? {};
  if (
    identity.expected_project_ref !== release.environment.project_ref ||
    identity.observed_project_ref !== release.environment.project_ref
  ) {
    fail('wrong project identity');
  }
  if (
    identity.expected_environment !== release.environment.name ||
    identity.observed_environment !== release.environment.name
  ) {
    fail('wrong environment identity');
  }
  if (identity.postgres_version !== release.environment.postgres_version) {
    fail('PostgreSQL version mismatch');
  }
  if (!/^psql \(PostgreSQL\) 17\./.test(identity.psql_version ?? '')) {
    fail('psql 17.x version evidence is required');
  }
  if (identity.release_checkout_clean !== true) {
    fail('release checkout is not clean');
  }

  const preflight = evidence.preflight ?? {};
  if (preflight.status !== 'PASS') fail('preflight did not pass');
  requireTimestamp(preflight.captured_at, 'preflight.captured_at');
  requireSha(preflight.output_sha256, 'preflight.output_sha256');
  if (
    preflight.ledger_count !== release.environment.hosted_ledger_count ||
    preflight.ledger_tip !== release.environment.hosted_ledger_tip ||
    preflight.ledger_fingerprint !==
      release.environment.hosted_ledger_version_name_fingerprint
  ) {
    fail('preflight ledger mismatch');
  }
  for (const [table, count] of Object.entries(release.expected_existing_rows)) {
    if (table === 'first_wave_total' || table === 'platform_role_memberships') {
      continue;
    }
    if (preflight.first_wave_counts?.[table] !== count) {
      fail(`preflight ${table} count mismatch`);
    }
  }
  if (
    preflight.stage7b_objects_absent !== true ||
    preflight.first_wave_columns_absent !== true
  ) {
    fail('Stage 7B partial state detected');
  }
  if (
    preflight.platform_role_count !==
    release.expected_existing_rows.platform_role_memberships
  ) {
    fail('platform-role count mismatch');
  }

  const cronJobs = evidence.cron?.jobs;
  if (!Array.isArray(cronJobs) || cronJobs.length !== EXPECTED_CRON.size) {
    fail('complete cron pause/drain evidence is required');
  }
  for (const [jobId, fingerprint] of EXPECTED_CRON) {
    const job = cronJobs.find((candidate) => candidate.job_id === jobId);
    if (!job) fail(`cron job ${jobId} evidence is missing`);
    if (job.fingerprint_before !== fingerprint) {
      fail(`cron job ${jobId} fingerprint mismatch`);
    }
    requireTimestamp(job.paused_at, `cron job ${jobId} paused_at`);
    if (job.pause_verified !== true || job.active_runs_after_drain !== 0) {
      fail(`cron job ${jobId} was not safely paused and drained`);
    }
  }

  const execution = evidence.execution ?? {};
  requireTimestamp(execution.started_at, 'execution.started_at');
  requireTimestamp(execution.finished_at, 'execution.finished_at');
  if (Date.parse(execution.finished_at) < Date.parse(execution.started_at)) {
    fail('execution timestamps are out of order');
  }
  if (
    execution.exit_status !== 0 ||
    execution.transaction_outcome !== 'COMMITTED'
  ) {
    fail('migration transaction did not commit');
  }
  requireSha(
    execution.redacted_output_sha256,
    'execution.redacted_output_sha256',
  );

  const verification = evidence.verification ?? {};
  if (verification.status !== 'PASS') fail('postflight did not pass');
  requireTimestamp(verification.captured_at, 'verification.captured_at');
  requireSha(verification.output_sha256, 'verification.output_sha256');
  for (const [field, expected] of Object.entries({
    ledger_unchanged: true,
    first_wave_null_count: 0,
    lineage_mismatch_count: 0,
    validated_foreign_keys: 4,
    canonical_dfw_count: 1,
    active_oregon_count: 0,
    provenance_row_count: 1,
    provenance_matches: true,
    security_checks_passed: true,
  })) {
    if (verification[field] !== expected) {
      fail(`verification.${field} mismatch`);
    }
  }

  const restore = evidence.restore ?? {};
  requireTimestamp(restore.completed_at, 'restore.completed_at');
  if (restore.all_jobs_restored !== true) fail('cron restore is incomplete');
  if (!Array.isArray(restore.jobs) || restore.jobs.length !== EXPECTED_CRON.size) {
    fail('complete cron restore evidence is required');
  }
  for (const [jobId, fingerprint] of EXPECTED_CRON) {
    const job = restore.jobs.find((candidate) => candidate.job_id === jobId);
    if (
      !job ||
      job.restored !== true ||
      job.fingerprint_after !== fingerprint
    ) {
      fail(`cron job ${jobId} restore mismatch`);
    }
  }

  if (
    evidence.failure?.incident_opened !== false ||
    evidence.failure?.disposition !== 'NO_FORWARD_REPAIR_REQUIRED'
  ) {
    fail('incident or forward-repair disposition is unresolved');
  }

  requireSha(evidence.append_only?.bundle_sha256, 'append_only.bundle_sha256');
  requireTimestamp(evidence.append_only?.validated_at, 'append_only.validated_at');
  if (evidence.append_only?.validator_version !== release.evidence.validator_version) {
    fail('evidence validator version mismatch');
  }

  return {
    ok: true,
    releaseId: release.release_id,
    candidateSha256: release.assembled.sha256,
  };
}

async function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath) fail('usage: validate-stage-7b-evidence.mjs <evidence.json>');
  const releasePath = new URL(
    '../docs/releases/stage-7b-corrected/release.json',
    import.meta.url,
  );
  const [evidence, release] = await Promise.all([
    readFile(evidencePath, 'utf8').then(JSON.parse),
    readFile(releasePath, 'utf8').then(JSON.parse),
  ]);
  const result = validateStage7bEvidence(evidence, release, {
    allowFixture: process.argv.includes('--allow-fixture'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
