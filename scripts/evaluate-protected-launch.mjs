import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as signBytes,
  verify as verifyBytes,
} from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_STATES = [
  'REPOSITORY_READY',
  'CONFIGURATION_VERIFIED',
  'DATABASE_RELEASED',
  'DEPLOYMENT_VERIFIED',
  'SYNTHETIC_BOOKING_PASSED',
  'VOICE_CONNECTIVITY_VERIFIED',
  'REAL_CALL_ACCEPTANCE_PASSED',
  'LANDING_PAGE_RELEASED',
  'MONITORING_STABLE',
];

const STATUS_VALUES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_EXECUTED']);
const REQUIRED_CLAIMS = {
  REPOSITORY_READY: [
    'clean_main',
    'full_validation_passed',
    'launch_contract_passed',
  ],
  CONFIGURATION_VERIFIED: [
    'project_identity_confirmed',
    'provider_matrix_passed',
    'public_booking_disabled',
  ],
  DATABASE_RELEASED: [
    'stage7b_hash_matched',
    'transaction_committed',
    'provenance_row_matched',
    'rls_verified',
    'cron_restored',
  ],
  DEPLOYMENT_VERIFIED: [
    'deployed_sha_matched',
    'edge_functions_verified',
    'public_booking_disabled',
    'smoke_tests_passed',
  ],
  SYNTHETIC_BOOKING_PASSED: [
    'approved_identity_only',
    'one_booking_lineage',
    'no_duplicate_effect',
    'cleanup_verified',
  ],
  VOICE_CONNECTIVITY_VERIFIED: [
    'isolated_number_mapped',
    'webhook_auth_verified',
    'dry_run_only',
    'artifact_retention_disabled',
  ],
  REAL_CALL_ACCEPTANCE_PASSED: [
    'fifteen_scenarios_passed',
    'no_unexpected_writes',
    'no_pii_artifacts',
  ],
  LANDING_PAGE_RELEASED: [
    'ctas_verified',
    'public_booking_enabled',
    'oregon_inactive',
  ],
  MONITORING_STABLE: [
    'observation_window_complete',
    'zero_unresolved_p0_p1',
    'alerts_operational',
  ],
};

const DEPENDENCIES = {
  REPOSITORY_READY: [],
  CONFIGURATION_VERIFIED: ['REPOSITORY_READY'],
  DATABASE_RELEASED: ['REPOSITORY_READY', 'CONFIGURATION_VERIFIED'],
  DEPLOYMENT_VERIFIED: ['DATABASE_RELEASED'],
  SYNTHETIC_BOOKING_PASSED: ['DEPLOYMENT_VERIFIED'],
  VOICE_CONNECTIVITY_VERIFIED: ['DEPLOYMENT_VERIFIED'],
  REAL_CALL_ACCEPTANCE_PASSED: [
    'SYNTHETIC_BOOKING_PASSED',
    'VOICE_CONNECTIVITY_VERIFIED',
  ],
  LANDING_PAGE_RELEASED: [
    'SYNTHETIC_BOOKING_PASSED',
    'REAL_CALL_ACCEPTANCE_PASSED',
  ],
  MONITORING_STABLE: ['LANDING_PAGE_RELEASED'],
};

const STATE_CONTRACTS = {
  REPOSITORY_READY: {
    evidenceKind: 'repository_validation_report',
    authorizationScope: 'repository_validation',
  },
  CONFIGURATION_VERIFIED: {
    evidenceKind: 'configuration_verification_report',
    authorizationScope: 'read_only_configuration_verification',
  },
  DATABASE_RELEASED: {
    evidenceKind: 'stage7b_database_release_report',
    authorizationScope: 'stage7b_schema_backfill_and_cron_window',
  },
  DEPLOYMENT_VERIFIED: {
    evidenceKind: 'production_deployment_report',
    authorizationScope: 'production_deployment',
  },
  SYNTHETIC_BOOKING_PASSED: {
    evidenceKind: 'protected_synthetic_booking_report',
    authorizationScope: 'protected_synthetic_booking',
  },
  VOICE_CONNECTIVITY_VERIFIED: {
    evidenceKind: 'voice_connectivity_report',
    authorizationScope: 'read_only_voice_connectivity',
  },
  REAL_CALL_ACCEPTANCE_PASSED: {
    evidenceKind: 'real_call_acceptance_report',
    authorizationScope: 'real_ai_voice_acceptance',
  },
  LANDING_PAGE_RELEASED: {
    evidenceKind: 'landing_page_release_report',
    authorizationScope: 'public_landing_release',
  },
  MONITORING_STABLE: {
    evidenceKind: 'production_monitoring_report',
    authorizationScope: 'post_release_monitoring',
  },
};

const repositoryRoot = resolve(import.meta.dirname, '..');

function fail(message) {
  throw new Error(message);
}

function isIsoDate(value) {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalApprovalPayload(approval) {
  return Buffer.from(JSON.stringify({
    schema_version: approval.schema_version,
    decision: approval.decision,
    evidence_bundle_sha256: approval.evidence_bundle_sha256,
    project_ref: approval.project_ref,
    environment: approval.environment,
    repository_sha: approval.repository_sha,
    go_owner_subject_id: approval.go_owner_subject_id,
    approved_at: approval.approved_at,
    expires_at: approval.expires_at,
    signing_key_sha256: approval.signing_key_sha256,
  }));
}

function publicKeySha256(publicKey) {
  const keyObject = typeof publicKey === 'string' || Buffer.isBuffer(publicKey)
    ? createPublicKey(publicKey)
    : publicKey;
  return sha256(keyObject.export({ type: 'spki', format: 'der' }));
}

function normalizeSubjectId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireImmutableSubjectId(value, path) {
  const normalized = normalizeSubjectId(value);
  if (
    value !== value?.trim() ||
    !/^[a-z0-9][a-z0-9:@._/-]{5,127}$/.test(normalized)
  ) {
    fail(`${path} must be a canonical immutable subject ID`);
  }
  return normalized;
}

function verifyGoOwnerApproval({
  approval,
  trustPublicKey,
  bundleSha256,
  projectRef,
  environment,
  repositorySha,
  now,
  stateSubjectIds,
}) {
  if (!approval || !trustPublicKey) {
    return {
      approved: false,
      reason: 'signed GO-owner approval and out-of-repository trust key are required',
    };
  }
  if (
    approval.schema_version !== 1 ||
    approval.decision !== 'GO' ||
    approval.evidence_bundle_sha256 !== bundleSha256 ||
    approval.project_ref !== projectRef ||
    approval.environment !== environment ||
    approval.repository_sha !== repositorySha
  ) {
    fail('GO-owner approval is not bound to the exact evidence bundle and release');
  }
  const goOwnerSubjectId = requireImmutableSubjectId(
    approval.go_owner_subject_id,
    'GO-owner subject',
  );
  if (stateSubjectIds.has(goOwnerSubjectId)) {
    fail('GO owner must be independent of state operators and reviewers');
  }
  if (!isIsoDate(approval.approved_at) || !isIsoDate(approval.expires_at)) {
    fail('GO-owner approval timestamps must be UTC ISO timestamps');
  }
  const approvedAt = Date.parse(approval.approved_at);
  const expiresAt = Date.parse(approval.expires_at);
  if (approvedAt > now.getTime()) fail('GO-owner approval is in the future');
  if (expiresAt <= approvedAt || expiresAt <= now.getTime()) {
    fail('GO-owner approval has expired');
  }
  if (expiresAt - approvedAt > 24 * 60 * 60_000) {
    fail('GO-owner approval validity exceeds 24 hours');
  }
  const keyHash = publicKeySha256(trustPublicKey);
  if (approval.signing_key_sha256 !== keyHash) {
    fail('GO-owner approval signing key does not match the configured trust key');
  }
  if (
    typeof approval.signature !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(approval.signature) ||
    !verifyBytes(
      null,
      canonicalApprovalPayload(approval),
      trustPublicKey,
      Buffer.from(approval.signature, 'base64'),
    )
  ) {
    fail('GO-owner approval signature is invalid');
  }
  return { approved: true, reason: null, goOwnerSubjectId };
}

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) &&
    !isAbsolute(rel);
}

function requireExactMeasurements(id, measurements) {
  if (!measurements || typeof measurements !== 'object') {
    fail(`${id}: captured evidence measurements are required`);
  }
  const exact = {
    REPOSITORY_READY: {
      validation_exit_code: 0,
      failing_tests: 0,
      dirty_files: 0,
      repository_gates_passed: 13,
    },
    CONFIGURATION_VERIFIED: {
      unverified_required_surfaces: 0,
      mutation_attempts: 0,
      credential_values_captured: 0,
      public_booking_enabled: false,
    },
    DATABASE_RELEASED: {
      psql_exit_code: 0,
      provenance_rows: 1,
      first_wave_nulls: 0,
      lineage_mismatches: 0,
      active_oregon_organizations: 0,
      cron_jobs_restored: 3,
    },
    DEPLOYMENT_VERIFIED: {
      deployed_sha_matches: true,
      disabled_probe_failures: 0,
      public_booking_enabled: false,
    },
    SYNTHETIC_BOOKING_PASSED: {
      approved_identity_matches: true,
      customer_delta_after_cleanup: 0,
      property_delta_after_cleanup: 0,
      quote_delta_after_cleanup: 0,
      active_booking_delta_after_cleanup: 0,
      retained_canceled_booking_rows: 1,
      retained_test_run_audit_rows: 1,
      active_jobber_artifact_delta_after_cleanup: 0,
      accepted_communications: 0,
      duplicate_effects: 0,
    },
    VOICE_CONNECTIVITY_VERIFIED: {
      live_calls_placed: 0,
      provider_tools_configured: 0,
      transfer_destinations_configured: 0,
      retained_artifacts_enabled: 0,
    },
    REAL_CALL_ACCEPTANCE_PASSED: {
      real_call_scenarios_passed: 12,
      offline_fault_scenarios_passed: 3,
      unexpected_writes: 0,
      retained_pii_artifacts: 0,
      unresolved_incidents: 0,
    },
    LANDING_PAGE_RELEASED: {
      cta_failures: 0,
      public_booking_enabled: true,
      active_oregon_organizations: 0,
    },
    MONITORING_STABLE: {
      unresolved_p0: 0,
      unresolved_p1: 0,
      alert_failures: 0,
      duplicate_effects: 0,
    },
  }[id];
  for (const [name, expected] of Object.entries(exact)) {
    if (measurements[name] !== expected) {
      fail(`${id}: measurement ${name} must equal ${expected}`);
    }
  }
  if (
    id === 'MONITORING_STABLE' &&
    (!Number.isFinite(measurements.observation_minutes) ||
      measurements.observation_minutes < 60)
  ) {
    fail('MONITORING_STABLE: observation_minutes must be at least 60');
  }
}

function requireUtcOrder(id, startedAt, completedAt, now) {
  if (!isIsoDate(startedAt) || !isIsoDate(completedAt)) {
    fail(`${id}: captured evidence needs UTC start and completion timestamps`);
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (started > completed) fail(`${id}: capture completed before it started`);
  if (completed > now.getTime()) fail(`${id}: capture completion is in the future`);
  return { started, completed };
}

export async function evaluateProtectedLaunch(
  bundlePath,
  {
    now = new Date(),
    allowFixture = false,
    goOwnerApproval = null,
    trustPublicKey = null,
  } = {},
) {
  const absoluteBundle = resolve(bundlePath);
  const evidenceRoot = dirname(absoluteBundle);
  const actualEvidenceRoot = await realpath(evidenceRoot);
  const actualRepositoryRoot = await realpath(repositoryRoot);
  if (!allowFixture && (
    actualEvidenceRoot === actualRepositoryRoot ||
    inside(actualRepositoryRoot, actualEvidenceRoot)
  )) {
    fail('captured launch evidence must be imported outside the repository');
  }
  const bundleBytes = await readFile(absoluteBundle);
  const bundle = JSON.parse(bundleBytes.toString('utf8'));

  if (bundle.schema_version !== 1 || !bundle.release) {
    fail('invalid protected-launch evidence schema');
  }
  const { project_ref: projectRef, environment, repository_sha: repositorySha } =
    bundle.release;
  if (!/^[a-z0-9]{20}$/.test(projectRef ?? '')) {
    fail('release.project_ref must be the exact 20-character project ref');
  }
  if (environment !== 'production') {
    fail('release.environment must be production');
  }
  if (!/^[0-9a-f]{40}$/.test(repositorySha ?? '')) {
    fail('release.repository_sha must be a full lowercase commit SHA');
  }
  if (!Array.isArray(bundle.states) || bundle.states.length !== REQUIRED_STATES.length) {
    fail('evidence bundle must contain exactly the nine required states');
  }

  const byId = new Map();
  for (const state of bundle.states) {
    if (!REQUIRED_STATES.includes(state.id) || byId.has(state.id)) {
      fail(`unknown or duplicate state ${state.id}`);
    }
    if (!STATUS_VALUES.has(state.status)) {
      fail(`${state.id}: invalid status ${state.status}`);
    }
    byId.set(state.id, state);
  }
  const usedArtifactPaths = new Set();
  const usedRecordIds = new Set();
  const usedAuthorizationIds = new Set();
  const usedAttestationRecordIds = new Set();
  const stateSubjectIds = new Set();
  const captureWindows = new Map();
  for (const id of REQUIRED_STATES) {
    if (!byId.has(id)) fail(`missing required state ${id}`);
  }

  for (const id of REQUIRED_STATES) {
    const state = byId.get(id);
    if (state.status !== 'PASS') {
      if (typeof state.reason !== 'string' || state.reason.trim().length < 8) {
        fail(`${id}: non-passing state requires a specific reason`);
      }
      continue;
    }

    for (const dependency of DEPENDENCIES[id]) {
      if (byId.get(dependency).status !== 'PASS') {
        fail(`${id}: dependency ${dependency} is not PASS`);
      }
    }
    if (
      state.project_ref !== projectRef ||
      state.environment !== environment ||
      state.repository_sha !== repositorySha
    ) {
      fail(`${id}: evidence identity does not match the release`);
    }
    if (!isIsoDate(state.captured_at) || !isIsoDate(state.expires_at)) {
      fail(`${id}: captured_at and expires_at must be UTC ISO timestamps`);
    }
    const capturedAt = Date.parse(state.captured_at);
    const expiresAt = Date.parse(state.expires_at);
    if (capturedAt > now.getTime()) {
      fail(`${id}: evidence timestamp is in the future`);
    }
    if (now.getTime() - capturedAt > 7 * 24 * 60 * 60_000) {
      fail(`${id}: evidence is older than seven days`);
    }
    if (expiresAt <= capturedAt || expiresAt <= now.getTime()) {
      fail(`${id}: evidence has expired`);
    }
    if (expiresAt - capturedAt > 7 * 24 * 60 * 60_000) {
      fail(`${id}: evidence validity exceeds seven days`);
    }
    const operatorId = requireImmutableSubjectId(
      state.operator,
      `${id}: operator`,
    );
    const reviewerId = requireImmutableSubjectId(
      state.reviewer,
      `${id}: reviewer`,
    );
    if (operatorId === reviewerId) {
      fail(`${id}: distinct operator and reviewer are required`);
    }
    stateSubjectIds.add(operatorId);
    stateSubjectIds.add(reviewerId);
    if (
      typeof state.authorization_id !== 'string' ||
      state.authorization_id !== state.authorization_id.trim() ||
      state.authorization_id.trim().length < 6
    ) {
      fail(`${id}: authorization_id is required`);
    }
    const normalizedAuthorizationId = state.authorization_id.toLowerCase();
    if (usedAuthorizationIds.has(normalizedAuthorizationId)) {
      fail(`${id}: authorization_id is reused by another launch state`);
    }
    usedAuthorizationIds.add(normalizedAuthorizationId);
    const claims = new Set(state.claims ?? []);
    for (const claim of REQUIRED_CLAIMS[id]) {
      if (!claims.has(claim)) fail(`${id}: missing required claim ${claim}`);
    }
    if (!Array.isArray(state.artifacts) || state.artifacts.length !== 1) {
      fail(`${id}: exactly one state-specific captured report is required`);
    }

    for (const artifact of state.artifacts) {
      if (
        typeof artifact.path !== 'string' ||
        isAbsolute(artifact.path) ||
        artifact.path.includes('..') ||
        /(?:^|\/)(?:README|.*template.*)\b/i.test(artifact.path) ||
        artifact.kind !== STATE_CONTRACTS[id].evidenceKind
      ) {
        fail(`${id}: artifact is not the required state-specific report`);
      }
      if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
        fail(`${id}: artifact SHA-256 is invalid`);
      }
      const requestedPath = resolve(evidenceRoot, artifact.path);
      const actualPath = await realpath(requestedPath).catch(() => null);
      const actualRoot = await realpath(evidenceRoot);
      if (!actualPath || !inside(actualRoot, actualPath)) {
        fail(`${id}: artifact escapes or is missing from the evidence bundle`);
      }
      if (usedArtifactPaths.has(actualPath)) {
        fail(`${id}: captured report is reused by another launch state`);
      }
      usedArtifactPaths.add(actualPath);
      const artifactBytes = await readFile(actualPath);
      if (sha256(artifactBytes) !== artifact.sha256) {
        fail(`${id}: artifact hash mismatch for ${artifact.path}`);
      }
      if (!artifact.path.endsWith('.json')) {
        fail(`${id}: primary captured report must be JSON`);
      }
      const report = JSON.parse(artifactBytes.toString('utf8'));
      if (!allowFixture && report.fixture !== false) {
        fail(`${id}: live captured report must explicitly declare fixture=false`);
      }
      if (
        report.schema_version !== 1 ||
        report.evidence_type !== STATE_CONTRACTS[id].evidenceKind ||
        report.state !== id ||
        report.result !== 'PASS'
      ) {
        fail(`${id}: captured report identity/result mismatch`);
      }
      if (
        report.project_ref !== projectRef ||
        report.environment !== environment ||
        report.repository_sha !== repositorySha
      ) {
        fail(`${id}: captured report release identity mismatch`);
      }
      if (
        report.authorization?.id !== state.authorization_id ||
        report.authorization?.scope !== STATE_CONTRACTS[id].authorizationScope ||
        report.authorization?.operator !== state.operator ||
        report.authorization?.reviewer !== state.reviewer ||
        report.authorization?.expires_at !== state.expires_at
      ) {
        fail(`${id}: captured report authorization binding mismatch`);
      }
      if (
        !isIsoDate(report.authorization?.approved_at) ||
        Date.parse(report.authorization.approved_at) >
          Date.parse(report.capture?.started_at ?? '')
      ) {
        fail(`${id}: authorization must predate captured execution`);
      }
      const window = requireUtcOrder(
        id,
        report.capture?.started_at,
        report.capture?.completed_at,
        now,
      );
      if (report.capture.completed_at !== state.captured_at) {
        fail(`${id}: state timestamp does not match captured completion`);
      }
      if (
        typeof report.capture?.source_system !== 'string' ||
        report.capture.source_system.trim().length < 3 ||
        typeof report.capture?.immutable_record_id !== 'string' ||
        report.capture.immutable_record_id.trim().length < 8
      ) {
        fail(`${id}: source system and immutable evidence record are required`);
      }
      if (usedRecordIds.has(report.capture.immutable_record_id)) {
        fail(`${id}: immutable evidence record is reused by another state`);
      }
      usedRecordIds.add(report.capture.immutable_record_id);
      if (
        report.attestation?.reviewer !== state.reviewer ||
        report.attestation?.result !== 'APPROVED' ||
        !isIsoDate(report.attestation?.reviewed_at) ||
        Date.parse(report.attestation.reviewed_at) < window.completed ||
        Date.parse(report.attestation.reviewed_at) > now.getTime() ||
        Date.parse(report.attestation.reviewed_at) > expiresAt ||
        typeof report.attestation?.evidence_system_record_id !== 'string' ||
        report.attestation.evidence_system_record_id.trim().length < 8
      ) {
        fail(`${id}: independent evidence-system attestation is incomplete`);
      }
      const attestationRecordId =
        report.attestation.evidence_system_record_id.trim().toLowerCase();
      if (usedAttestationRecordIds.has(attestationRecordId)) {
        fail(`${id}: attestation record is reused by another launch state`);
      }
      usedAttestationRecordIds.add(attestationRecordId);
      requireExactMeasurements(id, report.measurements);
      if (
        id === 'CONFIGURATION_VERIFIED' &&
        (
          report.measurements.provider_release_verified !== true ||
          !/^[0-9a-f]{64}$/.test(
            report.measurements.provider_verification_sha256 ?? '',
          ) ||
          typeof report.measurements.provider_verification_record_id !==
            'string' ||
          report.measurements.provider_verification_record_id.trim().length < 8
        )
      ) {
        fail(
          'CONFIGURATION_VERIFIED: provider release-verification hash and record are required',
        );
      }
      if (
        id === 'SYNTHETIC_BOOKING_PASSED' &&
        (
          typeof report.measurements.retained_audit_record_id !== 'string' ||
          report.measurements.retained_audit_record_id.trim().length < 8
        )
      ) {
        fail(
          'SYNTHETIC_BOOKING_PASSED: retained audit record identity is required',
        );
      }
      if (
        id === 'MONITORING_STABLE' &&
        window.completed - window.started < 60 * 60_000
      ) {
        fail('MONITORING_STABLE: captured observation window is under 60 minutes');
      }
      captureWindows.set(id, window);
    }
  }

  for (const id of REQUIRED_STATES) {
    if (byId.get(id).status !== 'PASS') continue;
    for (const dependency of DEPENDENCIES[id]) {
      if (
        captureWindows.get(id).started <
        captureWindows.get(dependency).completed
      ) {
        fail(`${id}: captured execution predates dependency ${dependency}`);
      }
    }
  }

  const states = REQUIRED_STATES.map((id) => ({
    id,
    status: byId.get(id).status,
    reason: byId.get(id).reason ?? null,
  }));
  const structurallyValid = states.every((state) => state.status === 'PASS');
  const approval = structurallyValid
    ? verifyGoOwnerApproval({
      approval: goOwnerApproval,
      trustPublicKey,
      bundleSha256: sha256(bundleBytes),
      projectRef,
      environment,
      repositorySha,
      now,
      stateSubjectIds,
    })
    : {
      approved: false,
      reason: 'all launch states must be PASS before GO-owner approval',
    };
  return {
    projectRef,
    environment,
    repositorySha,
    structurallyValid,
    goOwnerApproved: approval.approved,
    approvalReason: approval.reason,
    ready: structurallyValid && approval.approved,
    states,
  };
}

async function selfTest() {
  const root = resolve(
    dirname(fileURLToPath(import.meta.url)),
    'fixtures/protected-launch',
  );
  const validPath = resolve(root, 'valid/evidence.json');
  const clock = new Date('2026-07-29T18:30:00.000Z');
  const unsigned = await evaluateProtectedLaunch(validPath, {
    now: clock,
    allowFixture: true,
  });
  if (!unsigned.structurallyValid || unsigned.ready) {
    fail('unsigned protected-launch fixture did not remain structurally valid but NO-GO');
  }
  const bundleBytes = await readFile(validPath);
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const approval = {
    schema_version: 1,
    decision: 'GO',
    evidence_bundle_sha256: sha256(bundleBytes),
    project_ref: bundle.release.project_ref,
    environment: bundle.release.environment,
    repository_sha: bundle.release.repository_sha,
    go_owner_subject_id: 'fixture-go-owner',
    approved_at: '2026-07-29T18:20:00.000Z',
    expires_at: '2026-07-29T19:30:00.000Z',
    signing_key_sha256: publicKeySha256(publicKey),
  };
  approval.signature = signBytes(
    null,
    canonicalApprovalPayload(approval),
    privateKey,
  ).toString('base64');
  const valid = await evaluateProtectedLaunch(validPath, {
    now: clock,
    allowFixture: true,
    goOwnerApproval: approval,
    trustPublicKey: publicKey,
  });
  if (!valid.ready) fail('signed protected-launch fixture did not pass');

  const mutations = [
    ['wrong project', {
      mutateBundle: (value) => {
        value.states[1].project_ref = 'aaaaaaaaaaaaaaaaaaaa';
      },
    }],
    ['missing claim', {
      mutateBundle: (value) => {
        value.states[2].claims = [];
      },
    }],
    ['broken dependency', {
      mutateBundle: (value) => {
        value.states[0].status = 'FAIL';
        value.states[0].reason = 'fixture failure';
      },
    }],
    ['documentation evidence', {
      mutateBundle: (value) => {
        value.states[3].artifacts[0].kind = 'documentation';
      },
    }],
    ['expired evidence', {
      mutateBundle: (value) => {
        value.states[4].expires_at = '2026-07-29T18:00:00.000Z';
      },
    }],
    ['arbitrary report content', {
      stateId: 'SYNTHETIC_BOOKING_PASSED',
      replaceReport: { locally_authored_claim: true },
    }],
    ['wrong authorization scope', {
      stateId: 'VOICE_CONNECTIVITY_VERIFIED',
      mutateReport: (report) => {
        report.authorization.scope = 'unapproved_scope';
      },
    }],
    ['reverse dependency timestamps', {
      stateId: 'DEPLOYMENT_VERIFIED',
      mutateReport: (report) => {
        report.capture.started_at = '2026-07-29T17:01:00.000Z';
        report.capture.completed_at = '2026-07-29T17:02:00.000Z';
      },
      mutateBundle: (value) => {
        value.states.find((state) =>
          state.id === 'DEPLOYMENT_VERIFIED'
        ).captured_at = '2026-07-29T17:02:00.000Z';
      },
    }],
    ['zero monitoring window', {
      stateId: 'MONITORING_STABLE',
      mutateReport: (report) => {
        report.capture.started_at = '2026-07-29T18:20:00.000Z';
        report.capture.completed_at = '2026-07-29T18:20:00.000Z';
      },
      mutateBundle: (value) => {
        value.states.find((state) =>
          state.id === 'MONITORING_STABLE'
        ).captured_at = '2026-07-29T18:20:00.000Z';
      },
    }],
    ['cleanup residue', {
      stateId: 'SYNTHETIC_BOOKING_PASSED',
      mutateReport: (report) => {
        report.measurements.active_booking_delta_after_cleanup = 1;
      },
    }],
    ['reused authorization', {
      stateId: 'CONFIGURATION_VERIFIED',
      mutateBundle: (value) => {
        value.states[1].authorization_id = value.states[0].authorization_id;
      },
      mutateReport: (report) => {
        report.authorization.id = 'fixture-repository';
      },
    }],
    ['future attestation', {
      stateId: 'CONFIGURATION_VERIFIED',
      mutateReport: (report) => {
        report.attestation.reviewed_at = '2026-07-29T18:45:00.000Z';
      },
    }],
    ['reused attestation record', {
      stateId: 'CONFIGURATION_VERIFIED',
      mutateReport: (report) => {
        report.attestation.evidence_system_record_id =
          'fixture-attestation-repository';
      },
    }],
  ];

  for (const [name, mutation] of mutations) {
    try {
      await evaluateFixtureMutation(root, mutation, clock);
      fail(`invalid fixture unexpectedly passed: ${name}`);
    } catch (error) {
      if (String(error).includes('unexpectedly passed')) throw error;
    }
  }
  console.log(
    `Protected launch evaluator self-test: unsigned NO-GO, 1 signed valid, and ${mutations.length} hostile cases passed.`,
  );
}

async function evaluateFixtureMutation(root, mutation, now) {
  const { cp, mkdtemp, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'protected-launch-'));
  const fixtureRoot = resolve(temporaryRoot, 'evidence');
  await cp(resolve(root, 'valid'), fixtureRoot, { recursive: true });
  try {
    const bundlePath = resolve(fixtureRoot, 'evidence.json');
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    mutation.mutateBundle?.(bundle);
    if (mutation.stateId) {
      const state = bundle.states.find((candidate) =>
        candidate.id === mutation.stateId
      );
      const reportPath = resolve(fixtureRoot, state.artifacts[0].path);
      let report = JSON.parse(await readFile(reportPath, 'utf8'));
      if (mutation.replaceReport) report = mutation.replaceReport;
      mutation.mutateReport?.(report);
      const encoded = `${JSON.stringify(report)}\n`;
      await writeFile(reportPath, encoded);
      state.artifacts[0].sha256 = sha256(encoded);
    }
    await writeFile(bundlePath, `${JSON.stringify(bundle)}\n`);
    return await evaluateProtectedLaunch(bundlePath, {
      now,
      allowFixture: true,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await selfTest();
  } else {
    const positional = process.argv.slice(2).filter((arg, index, values) =>
      !arg.startsWith('-') &&
      values[index - 1] !== '--go-approval' &&
      values[index - 1] !== '--trust-key'
    );
    const bundlePath = positional[0];
    if (!bundlePath) {
      fail(
        'usage: node scripts/evaluate-protected-launch.mjs <evidence.json> ' +
          '[--go-approval approval.json --trust-key go-owner-public.pem] [--json]',
      );
    }
    const optionValue = (name) => {
      const index = process.argv.indexOf(name);
      return index >= 0 ? process.argv[index + 1] : null;
    };
    const approvalPath = optionValue('--go-approval');
    const trustKeyPath = optionValue('--trust-key');
    if (Boolean(approvalPath) !== Boolean(trustKeyPath)) {
      fail('--go-approval and --trust-key must be supplied together');
    }
    for (const path of [approvalPath, trustKeyPath].filter(Boolean)) {
      const actualPath = await realpath(resolve(path));
      const actualRepositoryRoot = await realpath(repositoryRoot);
      if (
        actualPath === actualRepositoryRoot ||
        inside(actualRepositoryRoot, actualPath)
      ) {
        fail('GO-owner approval and trust key must be outside the repository');
      }
    }
    const goOwnerApproval = approvalPath
      ? JSON.parse(await readFile(resolve(approvalPath), 'utf8'))
      : null;
    const trustPublicKey = trustKeyPath
      ? await readFile(resolve(trustKeyPath), 'utf8')
      : null;
    const report = await evaluateProtectedLaunch(bundlePath, {
      goOwnerApproval,
      trustPublicKey,
    });
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      console.log(
        `Protected launch evidence: ${
          report.structurallyValid ? 'STRUCTURALLY VALID' : 'NOT VALID'
        }`,
      );
      console.log(
        `GO-owner approval: ${
          report.goOwnerApproved ? 'VERIFIED' : `NOT VERIFIED — ${report.approvalReason}`
        }`,
      );
      console.log(`Protected launch: ${report.ready ? 'READY' : 'NOT READY'}`);
      for (const state of report.states) {
        console.log(`${state.id}: ${state.status}${state.reason ? ` — ${state.reason}` : ''}`);
      }
    }
    if (!report.ready) process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
