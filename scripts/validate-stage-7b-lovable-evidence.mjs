import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA256 = /^[0-9a-f]{64}$/;
const EXPECTED_JOBS = new Map([
  [3, '1a1b5b332626f37867e3521d2052f56b'],
  [5, '88e143e3876903e839e7551f68dd179b'],
  [6, 'ad8c290523e2659a608e7fcb7d57bcb7'],
]);

const fail = (message) => {
  throw new Error(message);
};
const requireString = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} required`);
};
const requireTimestamp = (value, label) => {
  requireString(value, label);
  if (!Number.isFinite(Date.parse(value))) fail(`${label} invalid`);
};
const requireSha = (value, label) => {
  if (!SHA256.test(value ?? '')) fail(`${label} invalid`);
};

export function validateStage7bLovableEvidence(
  evidence,
  manifest,
  { allowFixture = false } = {},
) {
  if (evidence.schema_version !== 1) fail('unsupported evidence schema');
  if (evidence.fixture && !allowFixture) fail('fixture evidence is not releasable');

  const release = evidence.release ?? {};
  if (release.release_id !== manifest.release_id) fail('release ID mismatch');
  if (release.release_commit !== manifest.release_commit) {
    fail('release commit mismatch');
  }
  if (release.operator_identity !== manifest.operator_identity) {
    fail('operator identity mismatch');
  }
  requireString(release.owner_authorization_id, 'owner authorization');

  const artifact = evidence.artifact ?? {};
  if (
    artifact.canonical_sha256 !== manifest.artifact.canonical_sha256 ||
    artifact.file_sha256 !== manifest.artifact.file_sha256 ||
    artifact.bytes !== manifest.artifact.bytes
  ) {
    fail('artifact identity mismatch');
  }
  if (
    artifact.complete_sql_reviewed !== true ||
    artifact.unrelated_migrations_excluded !== true
  ) {
    fail('complete isolated SQL review not proven');
  }

  const identity = evidence.identity ?? {};
  if (
    identity.expected_project_ref !== manifest.environment.project_ref ||
    identity.observed_project_ref !== manifest.environment.project_ref
  ) {
    fail('wrong project identity');
  }
  if (
    identity.expected_environment !== manifest.environment.name ||
    identity.observed_environment !== manifest.environment.name
  ) {
    fail('wrong environment identity');
  }
  if (identity.postgres_version !== manifest.environment.postgres_version) {
    fail('PostgreSQL version mismatch');
  }

  const preflight = evidence.preflight ?? {};
  if (preflight.status !== 'PASS') fail('preflight did not pass');
  requireTimestamp(preflight.captured_at, 'preflight timestamp');
  requireSha(preflight.catalog_output_sha256, 'preflight catalog hash');
  if (
    preflight.ledger_count !== manifest.environment.hosted_ledger_count ||
    preflight.ledger_tip !== manifest.environment.hosted_ledger_tip ||
    preflight.ledger_fingerprint !==
      manifest.environment.hosted_ledger_fingerprint
  ) {
    fail('preflight ledger mismatch');
  }
  for (const table of ['customers', 'properties', 'quotes', 'bookings']) {
    if (
      preflight.first_wave_counts?.[table] !==
      manifest.expected_existing_rows[table]
    ) {
      fail(`preflight ${table} count mismatch`);
    }
  }
  if (
    preflight.stage7b_objects_absent !== true ||
    preflight.first_wave_columns_absent !== true ||
    preflight.platform_role_count !==
      manifest.expected_existing_rows.platform_role_memberships
  ) {
    fail('preflight schema or platform-role mismatch');
  }

  const containment = evidence.containment ?? {};
  if (
    containment.public_booking_enabled_false !== true ||
    containment.secret_value_not_retained !== true
  ) {
    fail('public booking containment not proven');
  }
  if (
    !Array.isArray(containment.jobs) ||
    containment.jobs.length !== EXPECTED_JOBS.size
  ) {
    fail('complete job containment required');
  }
  for (const [jobId, fingerprint] of EXPECTED_JOBS) {
    const job = containment.jobs.find((candidate) => candidate.job_id === jobId);
    if (
      !job ||
      job.command_fingerprint !== fingerprint ||
      job.disabled !== true ||
      job.running_count !== 0
    ) {
      fail(`job ${jobId} not safely disabled and drained`);
    }
    requireTimestamp(job.disabled_at, `job ${jobId} disabled timestamp`);
  }

  const execution = evidence.execution ?? {};
  if (
    execution.lovable_approval_history_retained !== true ||
    execution.status !== 'COMMITTED'
  ) {
    fail('Lovable approval or committed execution evidence missing');
  }
  for (const field of ['approved_at', 'started_at', 'finished_at']) {
    requireTimestamp(execution[field], `execution ${field}`);
  }
  if (Date.parse(execution.finished_at) < Date.parse(execution.started_at)) {
    fail('execution timestamps out of order');
  }
  requireSha(execution.database_log_sha256, 'database log hash');

  const postflight = evidence.postflight ?? {};
  if (postflight.status !== 'PASS') fail('postflight did not pass');
  requireTimestamp(postflight.captured_at, 'postflight timestamp');
  requireSha(postflight.catalog_output_sha256, 'postflight catalog hash');
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
    if (postflight[field] !== expected) {
      fail(`postflight.${field} mismatch`);
    }
  }

  const restore = evidence.restore ?? {};
  requireTimestamp(restore.completed_at, 'restore timestamp');
  if (
    restore.all_jobs_restored !== true ||
    !Array.isArray(restore.jobs) ||
    restore.jobs.length !== EXPECTED_JOBS.size
  ) {
    fail('complete job restore evidence required');
  }
  for (const [jobId, fingerprint] of EXPECTED_JOBS) {
    const job = restore.jobs.find((candidate) => candidate.job_id === jobId);
    if (
      !job ||
      job.enabled !== true ||
      job.command_fingerprint !== fingerprint
    ) {
      fail(`job ${jobId} restore mismatch`);
    }
  }

  const retention = evidence.retention ?? {};
  for (const field of manifest.evidence.retained_sources) {
    if (retention[field] !== true) fail(`retention.${field} missing`);
  }
  requireSha(retention.bundle_sha256, 'retained evidence bundle hash');
  requireTimestamp(retention.validated_at, 'retention validation timestamp');
  if (retention.validator_version !== manifest.evidence.validator_version) {
    fail('validator version mismatch');
  }

  if (
    evidence.failure?.incident_opened !== false ||
    evidence.failure?.disposition !== 'NO_FORWARD_REPAIR_REQUIRED'
  ) {
    fail('failure disposition unresolved');
  }

  return {
    ok: true,
    release_id: manifest.release_id,
    artifact_sha256: manifest.artifact.canonical_sha256,
  };
}

function selfTestEvidence(manifest) {
  const timestamp = '2026-07-30T06:30:00Z';
  return {
    schema_version: 1,
    fixture: true,
    release: {
      release_id: manifest.release_id,
      release_commit: manifest.release_commit,
      operator_identity: manifest.operator_identity,
      owner_authorization_id: 'fixture-owner-authorization',
    },
    artifact: {
      canonical_sha256: manifest.artifact.canonical_sha256,
      file_sha256: manifest.artifact.file_sha256,
      bytes: manifest.artifact.bytes,
      complete_sql_reviewed: true,
      unrelated_migrations_excluded: true,
    },
    identity: {
      expected_project_ref: manifest.environment.project_ref,
      observed_project_ref: manifest.environment.project_ref,
      expected_environment: manifest.environment.name,
      observed_environment: manifest.environment.name,
      postgres_version: manifest.environment.postgres_version,
    },
    preflight: {
      status: 'PASS',
      captured_at: timestamp,
      catalog_output_sha256: '1'.repeat(64),
      ledger_count: manifest.environment.hosted_ledger_count,
      ledger_tip: manifest.environment.hosted_ledger_tip,
      ledger_fingerprint: manifest.environment.hosted_ledger_fingerprint,
      first_wave_counts: {
        customers: 16,
        properties: 10,
        quotes: 2,
        bookings: 2,
      },
      stage7b_objects_absent: true,
      first_wave_columns_absent: true,
      platform_role_count: 1,
    },
    containment: {
      public_booking_enabled_false: true,
      secret_value_not_retained: true,
      jobs: [...EXPECTED_JOBS].map(([job_id, command_fingerprint]) => ({
        job_id,
        command_fingerprint,
        disabled: true,
        running_count: 0,
        disabled_at: timestamp,
      })),
    },
    execution: {
      lovable_approval_history_retained: true,
      approved_at: timestamp,
      started_at: timestamp,
      finished_at: timestamp,
      status: 'COMMITTED',
      database_log_sha256: '2'.repeat(64),
    },
    postflight: {
      status: 'PASS',
      captured_at: timestamp,
      catalog_output_sha256: '3'.repeat(64),
      ledger_unchanged: true,
      first_wave_null_count: 0,
      lineage_mismatch_count: 0,
      validated_foreign_keys: 4,
      canonical_dfw_count: 1,
      active_oregon_count: 0,
      provenance_row_count: 1,
      provenance_matches: true,
      security_checks_passed: true,
    },
    restore: {
      completed_at: timestamp,
      all_jobs_restored: true,
      jobs: [...EXPECTED_JOBS].map(([job_id, command_fingerprint]) => ({
        job_id,
        command_fingerprint,
        enabled: true,
      })),
    },
    retention: Object.fromEntries([
      ...manifest.evidence.retained_sources.map((field) => [field, true]),
      ['bundle_sha256', '4'.repeat(64)],
      ['validated_at', timestamp],
      ['validator_version', manifest.evidence.validator_version],
    ]),
    failure: {
      incident_opened: false,
      disposition: 'NO_FORWARD_REPAIR_REQUIRED',
    },
  };
}

async function main() {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        '../docs/releases/stage-7b-lovable-v1/release.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  if (process.argv.includes('--self-test')) {
    const valid = selfTestEvidence(manifest);
    validateStage7bLovableEvidence(valid, manifest, { allowFixture: true });
    for (const mutate of [
      (e) => (e.identity.observed_project_ref = 'wrong-project'),
      (e) => (e.artifact.canonical_sha256 = '0'.repeat(64)),
      (e) => (e.containment.jobs[0].running_count = 1),
      (e) => (e.postflight.active_oregon_count = 1),
      (e) => (e.retention.atomic_provenance_row = false),
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      let rejected = false;
      try {
        validateStage7bLovableEvidence(invalid, manifest, {
          allowFixture: true,
        });
      } catch {
        rejected = true;
      }
      if (!rejected) fail('self-test accepted invalid evidence');
    }
    process.stdout.write('Stage 7B Lovable evidence hostile self-test passed.\n');
    return;
  }

  const evidencePath = process.argv[2];
  if (!evidencePath) {
    fail('usage: validate-stage-7b-lovable-evidence.mjs <evidence.json>');
  }
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));
  process.stdout.write(
    `${JSON.stringify(validateStage7bLovableEvidence(evidence, manifest))}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
