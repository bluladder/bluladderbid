import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateStage7bEvidence } from './validate-stage-7b-evidence.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const gitBlob = (value) =>
  createHash('sha1')
    .update(`blob ${Buffer.byteLength(value)}\0`)
    .update(value)
    .digest('hex');
const fail = (message) => {
  throw new Error(message);
};

const manifest = JSON.parse(
  await read('docs/releases/stage-7b-corrected/release.json'),
);
const source = await read(manifest.source.path);
const correction = await read(manifest.correction.path);
const provenance = await read(manifest.provenance.path);
const readme = await read('docs/releases/stage-7b-corrected/README.md');
const runbook = await read(manifest.execution.runbook);
const rehearsal = await read('scripts/rehearse-stage-7b-postgres.sh');
const securityTests = await read('supabase/tests/stage7b/verify_security.sql');
const evidenceTemplate = JSON.parse(await read(manifest.evidence.template));
const validEvidence = JSON.parse(
  await read('docs/releases/stage-7b-corrected/fixtures/evidence-valid.json'),
);
const invalidProjectEvidence = JSON.parse(
  await read(
    'docs/releases/stage-7b-corrected/fixtures/evidence-invalid-wrong-project.json',
  ),
);

for (const [name, value, expected] of [
  ['source', source, manifest.source],
  ['correction', correction, manifest.correction],
  ['provenance', provenance, manifest.provenance],
]) {
  if (Buffer.byteLength(value) !== expected.bytes) {
    fail(`${name} byte count changed`);
  }
  if (hash(value) !== expected.sha256) {
    fail(`${name} SHA-256 changed`);
  }
  if (gitBlob(value) !== expected.git_blob) {
    fail(`${name} Git blob identity changed`);
  }
}
if (
  manifest.source.commit !== '5904484df00d9762aa140f6a246d27078029da99' ||
  manifest.source.git_blob !== '4823d772a456a4a40f9883c408da3d85ba3a1d9d' ||
  manifest.correction.commit !==
    'baefb482fb999558f3e5914520e6e1939c55abcf' ||
  manifest.correction.git_blob !==
    'e37877cb8f8b67da42e2e9ed72f1919780bc9241' ||
  manifest.provenance.commit !== null ||
  manifest.provenance.commit_evidence !== 'artifact.provenance_commit' ||
  manifest.provenance.git_blob !==
    'e75945a712289db69421aaedee26e47254a40212'
) {
  fail('component commit or Git blob provenance changed');
}

const assembled = `${source.replace(/\nCOMMIT;\s*$/, '\n')}\n${correction.trim()}\n\n${provenance.trim()}\n\nCOMMIT;\n`;
if (
  hash(assembled) !== manifest.assembled.sha256 ||
  Buffer.byteLength(assembled) !== manifest.assembled.bytes
) {
  fail('assembled candidate identity changed');
}
if ((assembled.match(/\bBEGIN;/g) ?? []).length !== 1) {
  fail('candidate must have one BEGIN');
}
if ((assembled.match(/\bCOMMIT;/g) ?? []).length !== 1) {
  fail('candidate must have one COMMIT');
}
if (
  manifest.decision !== 'NO-GO' ||
  manifest.execution.selected_mechanism !== null ||
  manifest.execution.production_control_plane !== 'lovable_cloud' ||
  manifest.execution.compatibility !==
    'BLOCKED_UNSUPPORTED_CLIENT_BINDINGS'
) {
  fail('release must remain NO-GO with no supported Lovable execution selected');
}
if (manifest.hosted_mutation_authorized || manifest.ledger_rewrite_allowed) {
  fail('repository package cannot authorize hosted or ledger mutation');
}
for (const forbidden of [
  /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.is_organization_member\s*\([^)]*,/i,
  /organization_id\s+IS\s+NULL\s+OR/i,
  /SET\s+search_path\s*=\s*public/i,
]) {
  if (forbidden.test(correction)) {
    fail(`security correction contains forbidden pattern ${forbidden}`);
  }
}
for (const required of [
  'SET search_path = pg_catalog',
  'auth.uid()',
  'FROM PUBLIC, anon, service_role',
  'GRANT SELECT, INSERT, UPDATE, DELETE',
  'DROP FUNCTION IF EXISTS public.is_organization_member(uuid, uuid)',
]) {
  if (!correction.includes(required)) {
    fail(`security correction is missing ${required}`);
  }
}
for (const required of [
  'caller-selectable membership helper still exists',
  'cross-organization insert unexpectedly succeeded',
  'tenant admin escalated a membership to owner',
  'unaffiliated user saw DFW business rows',
  'Stage 8A objects were executed',
]) {
  if (!securityTests.includes(required)) {
    fail(`hostile tests are missing ${required}`);
  }
}
for (const required of [
  manifest.assembled.sha256,
  manifest.provenance.sha256,
  'Atomic provenance decision',
  'no longer selected for production',
  'Lovable Cloud',
  'NO-GO',
]) {
  if (!`${readme}\n${runbook}`.includes(required)) {
    fail(`release decision is missing ${required}`);
  }
}
if (!rehearsal.includes('assemble-stage-7b-release-candidate.mjs')) {
  fail('PostgreSQL rehearsal does not use the corrected candidate');
}
for (const variable of manifest.assembled.required_psql_variables) {
  if (!provenance.includes(`:'${variable}'`)) {
    fail(`provenance component is missing psql variable ${variable}`);
  }
}
for (const required of [
  'tenant_security.release_provenance',
  'release_provenance_append_only',
  'wrong Stage 7B project identity',
  'wrong Stage 7B environment',
  'existing Stage 7B provenance does not match this release',
]) {
  if (!provenance.includes(required)) {
    fail(`provenance component is missing ${required}`);
  }
}
if (
  !/FROM PUBLIC, anon, authenticated, service_role/.test(provenance) ||
  !/BEFORE UPDATE OR DELETE/.test(provenance)
) {
  fail('provenance append-only ACL contract is incomplete');
}

for (const evidenceSql of [
  manifest.evidence.preflight,
  manifest.evidence.postflight,
]) {
  const sql = await read(evidenceSql.path);
  if (
    hash(sql) !== evidenceSql.sha256 ||
    Buffer.byteLength(sql) !== evidenceSql.bytes
  ) {
    fail(`${evidenceSql.path} SHA-256 changed`);
  }
  if (
    !/BEGIN TRANSACTION READ ONLY;/i.test(sql) ||
    !/\bROLLBACK;/i.test(sql)
  ) {
    fail(`${evidenceSql.path} is not transaction-enforced read-only`);
  }
  if (
    /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
      sql.replace(/--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''"),
    )
  ) {
    fail(`${evidenceSql.path} contains a mutation token`);
  }
}

if (evidenceTemplate.fixture !== false) {
  fail('operator evidence template cannot be marked as a fixture');
}
validateStage7bEvidence(validEvidence, manifest, { allowFixture: true });

function expectEvidenceFailure(name, mutate) {
  const evidence = structuredClone(validEvidence);
  mutate(evidence);
  try {
    validateStage7bEvidence(evidence, manifest, { allowFixture: true });
  } catch {
    return;
  }
  fail(`evidence validator accepted ${name}`);
}

expectEvidenceFailure('wrong project', (evidence) => {
  evidence.identity.observed_project_ref = 'wrong-project';
});
expectEvidenceFailure('wrong environment', (evidence) => {
  evidence.identity.observed_environment = 'preview';
});
expectEvidenceFailure('incorrect source hash', (evidence) => {
  evidence.artifact.source_sha256 = '0'.repeat(64);
});
expectEvidenceFailure('incorrect assembled hash', (evidence) => {
  evidence.artifact.candidate_sha256 = '0'.repeat(64);
});
expectEvidenceFailure('missing provenance commit', (evidence) => {
  evidence.artifact.provenance_commit = '';
});
expectEvidenceFailure('unverified provenance commit', (evidence) => {
  evidence.artifact.provenance_commit_contains_blob = false;
});
expectEvidenceFailure('missing preflight evidence', (evidence) => {
  evidence.preflight.output_sha256 = '';
});
expectEvidenceFailure('failed preflight', (evidence) => {
  evidence.preflight.status = 'FAIL';
});
expectEvidenceFailure('unsafe cron pause', (evidence) => {
  evidence.cron.jobs[0].pause_verified = false;
});
expectEvidenceFailure('migration verification mismatch', (evidence) => {
  evidence.verification.first_wave_null_count = 1;
});
expectEvidenceFailure('provenance mismatch', (evidence) => {
  evidence.verification.provenance_matches = false;
});
expectEvidenceFailure('incomplete restore', (evidence) => {
  evidence.restore.all_jobs_restored = false;
});
let invalidProjectRejected = false;
try {
  validateStage7bEvidence(invalidProjectEvidence, manifest, {
    allowFixture: true,
  });
} catch {
  invalidProjectRejected = true;
}
if (!invalidProjectRejected) {
  fail('explicit wrong-project fixture unexpectedly passed');
}

await stat(resolve(root, manifest.correction.path));
await stat(resolve(root, manifest.provenance.path));
await stat(resolve(root, manifest.evidence.validator));

console.log(
  'Stage 7B corrected release valid: one atomic 24,721-byte candidate, ' +
    'private append-only provenance, hardened RLS, no supported Lovable ' +
    'execution mechanism selected, NO-GO.',
);
