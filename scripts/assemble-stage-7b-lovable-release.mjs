import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourcePath = resolve(
  root,
  'supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql',
);
const correctionPath = resolve(
  root,
  'supabase/release-candidates/20260729030000_tenant_foundation_stage_7b_rc_security.sql',
);
const provenancePath = resolve(
  root,
  'supabase/release-candidates/20260730060000_tenant_foundation_stage_7b_lovable_provenance.sql',
);
const outputPath = resolve(
  process.argv[2] ??
    'supabase/release-candidates/20260730061000_tenant_foundation_stage_7b_lovable.sql',
);
const placeholder = '__ARTIFACT_SHA256__';
const terminalCommit = /\nCOMMIT;\s*$/;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const [source, correction, provenance] = await Promise.all([
  readFile(sourcePath, 'utf8'),
  readFile(correctionPath, 'utf8'),
  readFile(provenancePath, 'utf8'),
]);

if (!source.startsWith('-- Issue #7, Stage 7B') || !terminalCommit.test(source)) {
  throw new Error('immutable Stage 7B transaction boundary changed');
}
if (
  [correction, provenance].some((component) =>
    /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(component)
  )
) {
  throw new Error('release components must inherit the Stage 7B transaction');
}
if ((provenance.match(new RegExp(placeholder, 'g')) ?? []).length !== 1) {
  throw new Error('provenance must contain one artifact hash placeholder');
}
if (/:'[a-z_][a-z0-9_]*'/i.test(provenance)) {
  throw new Error('Lovable provenance cannot contain psql substitutions');
}

const canonical = `${source.replace(terminalCommit, '\n')}\n${correction.trim()}\n\n${provenance.trim()}\n\nCOMMIT;\n`;
const artifactSha256 = sha256(canonical);
const artifact = canonical.replace(placeholder, artifactSha256);

await writeFile(outputPath, artifact, 'utf8');

process.stdout.write(
  `${JSON.stringify({
    artifact_sha256: artifactSha256,
    file_sha256: sha256(artifact),
    bytes: Buffer.byteLength(artifact),
    transaction_count: 1,
    output: outputPath,
  })}\n`,
);
