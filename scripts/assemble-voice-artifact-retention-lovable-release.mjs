import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourcePath = resolve(
  root,
  "supabase/migrations/20260802043233_voice_artifact_retention_purge.sql",
);
const controlPath = resolve(
  root,
  "supabase/release-candidates/voice_artifact_retention_lovable_control.sql",
);
const outputPath = resolve(
  process.argv[2] ??
    "supabase/release-candidates/20260802043233_voice_artifact_retention_purge_lovable.sql",
);

const expectedSourceSha256 =
  "a1580013cf7f72e31b75e6fb75f67995936d8636748bc0a141f3c6ce5cf78102";
const tokens = {
  canonical: "__CANONICAL_SQL__",
  sourceSha256: "__SOURCE_SHA256__",
  controlSha256: "__CONTROL_SHA256__",
  artifactSha256: "__ARTIFACT_SHA256__",
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const [source, control] = await Promise.all([
  readFile(sourcePath, "utf8"),
  readFile(controlPath, "utf8"),
]);

if (sha256(source) !== expectedSourceSha256) {
  throw new Error("canonical voice retention source identity changed");
}
if (Buffer.byteLength(source) !== 9958 || !source.endsWith("\n")) {
  throw new Error("canonical source bytes or terminal newline changed");
}
if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/im.test(source)) {
  throw new Error("canonical source unexpectedly owns a transaction boundary");
}
for (const [label, token] of Object.entries(tokens)) {
  if ((control.match(new RegExp(token, "g")) ?? []).length !== 1) {
    throw new Error(`control template must contain one ${label} token`);
  }
}
if (/\\set|:'[a-z_][a-z0-9_]*'/i.test(control)) {
  throw new Error("Lovable control template contains a psql substitution");
}

const controlSha256 = sha256(control);
const canonicalArtifact = control
  .replace(tokens.canonical, () => source)
  .replace(tokens.sourceSha256, expectedSourceSha256)
  .replace(tokens.controlSha256, controlSha256);
const artifactSha256 = sha256(canonicalArtifact);
const artifact = canonicalArtifact.replace(
  tokens.artifactSha256,
  artifactSha256,
);

if (
  !artifact.includes(source) ||
  artifact.indexOf(source) !== artifact.lastIndexOf(source)
) {
  throw new Error(
    "canonical source must be embedded byte-for-byte exactly once",
  );
}
if ((artifact.match(/^BEGIN;$/gm) ?? []).length !== 1) {
  throw new Error("Lovable artifact must contain one explicit BEGIN");
}
if ((artifact.match(/^COMMIT;$/gm) ?? []).length !== 1) {
  throw new Error("Lovable artifact must contain one terminal COMMIT");
}

await writeFile(outputPath, artifact, "utf8");

process.stdout.write(
  `${
    JSON.stringify({
      source_sha256: expectedSourceSha256,
      source_bytes: Buffer.byteLength(source),
      control_sha256: controlSha256,
      canonical_artifact_sha256: artifactSha256,
      file_sha256: sha256(artifact),
      bytes: Buffer.byteLength(artifact),
      stored_without_terminal_lf_sha256: sha256(artifact.slice(0, -1)),
      stored_without_terminal_lf_bytes: Buffer.byteLength(
        artifact.slice(0, -1),
      ),
      transaction_count: 1,
      output: outputPath,
    })
  }\n`,
);
