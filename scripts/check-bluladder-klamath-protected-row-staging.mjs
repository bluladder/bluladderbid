import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  operation: "supabase/operations/bluladder_klamath_protected_row_staging.sql",
  preflight: "supabase/preflight/bluladder_klamath_protected_row_staging.sql",
  postflight:
    "supabase/verification/bluladder_klamath_protected_row_staging.sql",
  readiness:
    "docs/operations/bluladder-klamath-protected-row-staging-readiness.json",
  replacement:
    "supabase/migrations/20260822170000_bluladder_klamath_activation_supersession.sql",
  cutover: "supabase/operations/bluladder_klamath_customer_traffic_cutover.sql",
  pause: "supabase/operations/bluladder_klamath_customer_traffic_pause.sql",
  cutoverPostflight:
    "supabase/verification/bluladder_klamath_customer_traffic_cutover.sql",
  manifest: "supabase/functions/_shared/voiceProviderKlamathConfig.ts",
  activationChecker: "scripts/check-bluladder-klamath-activation-supersession.mjs",
  package: "package.json",
  ci: ".github/workflows/ci.yml",
};

const content = {};
const errors = [];
for (const [key, relative] of Object.entries(files)) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) errors.push(`missing ${relative}`);
  else content[key] = fs.readFileSync(absolute, "utf8");
}

const sha256 = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const requireText = (key, text) => {
  if (!content[key]?.includes(text)) errors.push(`${files[key]} omits: ${text}`);
};

const preserved = {
  replacement: [16_287, "d1a7801f90bb5e3f3594146b72359dd23552ad39ddd148a04560db81222ddfe3"],
  cutover: [9_178, "423d5fe6e9e3e92cf87609f895a2e296df3860a208cb775320702fd4d9f01d0f"],
  pause: [2_542, "f994edb6f94d0b1daad2c6edeb663dc32c4f9ede9d2bc1e0417c384bf3a661a6"],
  cutoverPostflight: [6_640, "487dc985f9be121803dab271cbb3dc43dfb16a0862dc83e98dda6bcbf790ce5d"],
  manifest: [9_195, "f17d2fe0b50a6de7921ad137f5b9f996fcc0edafab357951e60829c0278e5de1"],
};
for (const [key, [bytes, digest]] of Object.entries(preserved)) {
  const value = Buffer.from(content[key] ?? "", "utf8");
  if (value.length !== bytes || sha256(value) !== digest) {
    errors.push(`${files[key]} changed byte-for-byte`);
  }
}

for (const text of [
  "BEGIN;",
  "LOCK TABLE",
  "current_setting(",
  "bluladder.klamath_sms_sender_identity",
  "bluladder.klamath_transfer_phone",
  "bluladder.klamath_alert_phone",
  "bluladder.klamath_alert_email",
  "connector_rows <> 1 OR recipient_rows <> 2",
  "status = 'inactive'",
  "is_enabled = false",
  "customer_traffic_allowed = false",
  "COMMIT;",
]) requireText("operation", text);

const inserts = content.operation?.match(/INSERT INTO public\.[a-z_]+/g) ?? [];
if (
  inserts.length !== 2 ||
  inserts[0] !== "INSERT INTO public.organization_messaging_connectors" ||
  inserts[1] !== "INSERT INTO public.escalation_recipients"
) errors.push("staging operation is not the exact two-statement, three-row insert");

for (const forbidden of [
  /\bUPDATE\s+public\./i,
  /\bDELETE\s+FROM\s+public\./i,
  /\bINSERT\s+INTO\s+supabase_migrations\./i,
  /\b(?:CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b/i,
  /\bON\s+CONFLICT\b/i,
]) {
  if (forbidden.test(content.operation ?? "")) {
    errors.push(`${files.operation} contains forbidden SQL: ${forbidden}`);
  }
}

for (const key of ["preflight", "postflight"]) {
  requireText(key, "BEGIN TRANSACTION READ ONLY;");
  requireText(key, "ROLLBACK;");
  if (/\b(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/i.test(content[key] ?? "")) {
    errors.push(`${files[key]} contains a forbidden mutation`);
  }
}

let readiness;
try {
  readiness = JSON.parse(content.readiness ?? "{}");
} catch (error) {
  errors.push(`${files.readiness} is invalid JSON: ${error.message}`);
}
if (readiness) {
  if (
    readiness.schema_version !== 1 ||
    readiness.tenant_key !== "bluladder-klamath" ||
    readiness.contains_private_values !== false ||
    readiness.expected_hosted_ledger?.count !== 166 ||
    readiness.expected_hosted_ledger?.tip !== "20260815043425" ||
    readiness.expected_mutations?.total_rows_inserted !== 3 ||
    readiness.expected_mutations?.updates !== 0 ||
    readiness.expected_mutations?.migration_ledger_rows !== 0 ||
    readiness.execution?.performed !== false
  ) errors.push("protected-row staging readiness is not exact and fail closed");

  for (const key of ["operation", "preflight", "postflight"]) {
    const artifact = readiness.artifacts?.[key];
    const value = Buffer.from(content[key] ?? "", "utf8");
    if (
      artifact?.path !== files[key] ||
      artifact?.bytes !== value.length ||
      artifact?.sha256 !== sha256(value)
    ) errors.push(`readiness identity drifted for ${files[key]}`);
  }
}

const protectedValueHashes = new Set([
  "5634195d7b461a4ef99799146b1146c7f85e042931ca87246cfb9beadc22af65",
  "f413a45efe96381f82754c03dc0005c41785393303bda45837e2cd458f111008",
  "733e21f1aa22bbaeb3bbd52b5377e1f6ce0531e81262611c14991c84c44089d8",
]);
for (const key of ["operation", "preflight", "postflight", "readiness"]) {
  const literals = [
    ...((content[key] ?? "").match(/\+[1-9][0-9]{7,14}/g) ?? []),
    ...((content[key] ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
  ];
  for (const literal of literals) {
    if (protectedValueHashes.has(sha256(literal.toLowerCase()))) {
      errors.push(`${files[key]} contains a protected destination literal`);
    }
  }
}

requireText("package", '"check:klamath-protected-row-staging"');
requireText(
  "activationChecker",
  'import("./check-bluladder-klamath-protected-row-staging.mjs")',
);
requireText("ci", "bun run check:klamath-protected-row-staging");

if (errors.length) {
  console.error("Klamath protected-row staging contract failed:\n");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Klamath protected-row staging contract passed (execution remains pending).",
);
