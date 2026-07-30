import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const originalPath = resolve(
  root,
  'supabase/migrations/20260728060000_tenant_foundation_stage_7b.sql',
);
const correctionPath = resolve(
  root,
  'supabase/release-candidates/20260729030000_tenant_foundation_stage_7b_rc_security.sql',
);
const provenancePath = resolve(
  root,
  'supabase/release-candidates/20260729031000_tenant_foundation_stage_7b_provenance.sql',
);
const outputPath = resolve(process.argv[2] ?? '/tmp/stage7b-release-candidate.sql');

const original = await readFile(originalPath, 'utf8');
const correction = await readFile(correctionPath, 'utf8');
const provenance = await readFile(provenancePath, 'utf8');
const terminalCommit = /\nCOMMIT;\s*$/;

if (!original.startsWith('-- Issue #7, Stage 7B') || !terminalCommit.test(original)) {
  throw new Error('immutable Stage 7B transaction boundary changed');
}
if (
  [correction, provenance].some((component) =>
    /\b(?:BEGIN|COMMIT|ROLLBACK)\s*;/i.test(component)
  )
) {
  throw new Error('release components must inherit the Stage 7B transaction');
}

const assembled = `${original.replace(terminalCommit, '\n')}\n${correction.trim()}\n\n${provenance.trim()}\n\nCOMMIT;\n`;
await writeFile(outputPath, assembled, 'utf8');

const hash = createHash('sha256').update(assembled).digest('hex');
process.stdout.write(`${hash}  ${outputPath}\n`);
