import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFile(resolve(root, path), 'utf8');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => {
  throw new Error(message);
};

const manifest = JSON.parse(
  await read('docs/releases/stage-7b-corrected/release.json'),
);
const source = await read(manifest.source.path);
const correction = await read(manifest.correction.path);
const readme = await read('docs/releases/stage-7b-corrected/README.md');
const rehearsal = await read('scripts/rehearse-stage-7b-postgres.sh');
const securityTests = await read('supabase/tests/stage7b/verify_security.sql');

for (const [name, value, expected] of [
  ['source', source, manifest.source],
  ['correction', correction, manifest.correction],
]) {
  if (Buffer.byteLength(value) !== expected.bytes) {
    fail(`${name} byte count changed`);
  }
  if (hash(value) !== expected.sha256) {
    fail(`${name} SHA-256 changed`);
  }
}

const assembled = `${source.replace(/\nCOMMIT;\s*$/, '\n')}\n${correction.trim()}\n\nCOMMIT;\n`;
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
if (manifest.decision !== 'NO-GO' || manifest.execution.selected_mechanism) {
  fail('execution must remain NO-GO without a selected mechanism');
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
  'apply_migration',
  'Direct execution remains prohibited',
]) {
  if (!readme.includes(required)) {
    fail(`release decision is missing ${required}`);
  }
}
if (!rehearsal.includes('assemble-stage-7b-release-candidate.mjs')) {
  fail('PostgreSQL rehearsal does not use the corrected candidate');
}
await stat(resolve(root, manifest.correction.path));

console.log(
  'Stage 7B corrected release valid: one atomic 19,291-byte candidate, ' +
    'hardened RLS, hostile authorization suite, execution mechanism NO-GO.',
);
