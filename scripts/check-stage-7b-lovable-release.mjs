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
const [source, correction, provenance, artifact, preflight, mcpPreflightText, postflight, runbook] =
  await Promise.all([
    read(manifest.source.path),
    read(manifest.correction.path),
    read(manifest.provenance.path),
    read(manifest.artifact.path),
    read(manifest.preflight.path),
    read(manifest.preflight.mcp_path),
    read(manifest.postflight.path),
    read(manifest.runbook),
  ]);
const mcpPreflight = JSON.parse(mcpPreflightText);

if (
  manifest.environment.hosted_ledger_count !== 145 ||
  manifest.environment.hosted_ledger_tip !== '20260726194719' ||
  manifest.environment.hosted_ledger_fingerprint !==
    '73ed8522db78e51049a421e1f72b18c3'
) {
  fail('historical pre-execution ledger evidence changed');
}
if (
  manifest.post_execution_ledger?.count !== 146 ||
  manifest.post_execution_ledger?.tip !== '20260730072508' ||
  manifest.post_execution_ledger?.version_name_fingerprint !==
    '3d447d837baa2a593f45fd111fc2ac04' ||
  manifest.post_execution_ledger?.new_row_count !== 1 ||
  manifest.post_execution_ledger?.new_row_statement_count !== 1 ||
  manifest.post_execution_ledger?.stored_statement_bytes !== 24333 ||
  manifest.post_execution_ledger?.stored_statement_md5 !==
    'e2044ddcc7b42d37c77a8db4965b4b6d'
) {
  fail('post-execution Lovable ledger evidence changed');
}

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
for (const required of [
  'count(*) = 146',
  "max(version) = '20260730072508'",
  '3d447d837baa2a593f45fd111fc2ac04',
]) {
  if (!postflight.includes(required)) {
    fail(`postflight missing post-execution ledger baseline ${required}`);
  }
}
if (sha256(mcpPreflightText) !== manifest.preflight.mcp_sha256) {
  fail('MCP preflight hash changed');
}
if (
  mcpPreflight.submission_contract !==
    'one SELECT statement per query_database call' ||
  mcpPreflight.project_id !== 'b6e0d823-59c4-4b5a-afbe-182485e5458b' ||
  mcpPreflight.project_ref !== manifest.environment.project_ref ||
  mcpPreflight.environment !== manifest.environment.name ||
  mcpPreflight.queries.length !== 7
) {
  fail('MCP preflight identity or submission contract changed');
}
for (const query of mcpPreflight.queries) {
  const sql = query.sql.trim();
  if (
    !/^SELECT\b/i.test(sql) ||
    /;\s*\S/.test(sql) ||
    /\b(BEGIN|COMMIT|ROLLBACK|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(
      sql.replace(/'(?:''|[^'])*'/g, "''"),
    )
  ) {
    fail(`MCP preflight query ${query.id} is not one read-only SELECT`);
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
