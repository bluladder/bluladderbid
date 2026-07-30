import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => {
  throw new Error(message);
};

const manifest = JSON.parse(
  await read('docs/releases/stage-7b-lovable-v1/release.json'),
);
const [source, correction, provenance, artifact, preflight, postflight, runbook] =
  await Promise.all([
    read(manifest.source.path),
    read(manifest.correction.path),
    read(manifest.provenance.path),
    read(manifest.artifact.path),
    read(manifest.preflight.path),
    read(manifest.postflight.path),
    read(manifest.runbook),
  ]);

for (const [name, value, expected] of [
  ['source', source, manifest.source],
  ['correction', correction, manifest.correction],
  ['provenance', provenance, manifest.provenance],
]) {
  if (
    sha256(value) !== expected.sha256 ||
    Buffer.byteLength(value) !== expected.bytes
  ) {
    fail(`${name} identity changed`);
  }
}
if (
  sha256(artifact) !== manifest.artifact.file_sha256 ||
  Buffer.byteLength(artifact) !== manifest.artifact.bytes
) {
  fail('Lovable artifact file identity changed');
}
const canonical = artifact.replace(
  manifest.artifact.canonical_sha256,
  '__ARTIFACT_SHA256__',
);
if (sha256(canonical) !== manifest.artifact.canonical_sha256) {
  fail('Lovable artifact canonical identity changed');
}
if ((artifact.match(/^BEGIN;$/gm) ?? []).length !== 1) {
  fail('artifact must contain one explicit BEGIN');
}
if ((artifact.match(/^COMMIT;$/gm) ?? []).length !== 1) {
  fail('artifact must contain one terminal COMMIT');
}
if (/:'[a-z_][a-z0-9_]*'/i.test(artifact)) {
  fail('artifact contains a psql substitution');
}
for (const required of [
  manifest.release_id,
  manifest.release_commit,
  manifest.artifact.canonical_sha256,
  manifest.environment.project_ref,
  manifest.environment.name,
  manifest.operator_identity,
  manifest.owner_approval_record,
  'transaction_timestamp()',
  'BEFORE UPDATE OR DELETE',
  'wrong Stage 7B project identity',
  'wrong Stage 7B environment',
]) {
  if (!artifact.includes(required)) fail(`artifact missing ${required}`);
}
for (const [name, sql, expected] of [
  ['preflight', preflight, manifest.preflight],
  ['postflight', postflight, manifest.postflight],
]) {
  if (sha256(sql) !== expected.sha256) fail(`${name} hash changed`);
  if (
    !/BEGIN TRANSACTION READ ONLY;/i.test(sql) ||
    !/\bROLLBACK;/i.test(sql) ||
    /\\set|:'[a-z_]/i.test(sql)
  ) {
    fail(`${name} is not Lovable-native read-only SQL`);
  }
  if (
    /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
      sql.replace(/--.*$/gm, '').replace(/'(?:''|[^'])*'/g, "''"),
    )
  ) {
    fail(`${name} contains a mutation token`);
  }
}
if (
  manifest.decision !== 'GO_FOR_SEPARATELY_AUTHORIZED_CONTROLLED_EXECUTION' ||
  manifest.hosted_mutation_authorized !== false ||
  manifest.production_control_plane !== 'lovable_cloud'
) {
  fail('release decision or authorization boundary changed');
}
for (const forbiddenRequirement of [
  'independent_reviewer',
  'ed25519',
  'trust_key',
  'atomic_function_deployment',
]) {
  if (JSON.stringify(manifest).toLowerCase().includes(forbiddenRequirement)) {
    fail(`superseded release blocker remains: ${forbiddenRequirement}`);
  }
}
for (const required of [
  'PUBLIC_BOOKING_ENABLED',
  'jobs 3, 5, and 6',
  'complete SQL approval card',
  'jobber-create-booking',
  'jobber-create-service-request',
  'admin-diagnostics',
  'Exact first authorization request',
]) {
  if (!runbook.includes(required)) fail(`runbook missing ${required}`);
}

await Promise.all([
  stat(resolve(root, manifest.evidence.template)),
  stat(resolve(root, manifest.evidence.validator)),
  stat(resolve(root, 'scripts/rehearse-stage-7b-lovable-postgres.sh')),
]);

console.log(
  'Stage 7B Lovable release valid: canonical ' +
    `${manifest.artifact.canonical_sha256}, ${manifest.artifact.bytes} bytes, ` +
    'one transaction, zero psql substitutions, owner-operated protected GO.',
);
