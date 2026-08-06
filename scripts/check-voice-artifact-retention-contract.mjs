import fs from "node:fs";

const migrationPath =
  "supabase/migrations/20260802043233_voice_artifact_retention_purge.sql";
const rehearsalPath = "scripts/rehearse-voice-artifact-retention-postgres.sh";
const runbookPath = "docs/voice/voice-artifact-retention-release.md";
const preflightPath =
  "supabase/verification/voice_artifact_retention_preflight.sql";
const postflightPath =
  "supabase/verification/voice_artifact_retention_postflight.sql";
const stage7bCheckerPath = "scripts/check-tenant-authority-stage-7b-v2.mjs";
const ciPath = ".github/workflows/ci.yml";
const manifestPath =
  "supabase/functions/_shared/voiceProviderConfig.ts";
const provisioningPath = "docs/voice-beta-vapi-provisioning.md";

const migration = fs.readFileSync(migrationPath, "utf8");
const rehearsal = fs.readFileSync(rehearsalPath, "utf8");
const runbook = fs.readFileSync(runbookPath, "utf8");
const preflight = fs.readFileSync(preflightPath, "utf8");
const postflight = fs.readFileSync(postflightPath, "utf8");
const stage7bChecker = fs.readFileSync(stage7bCheckerPath, "utf8");
const ci = fs.readFileSync(ciPath, "utf8");
const manifest = fs.readFileSync(manifestPath, "utf8");
const provisioning = fs.readFileSync(provisioningPath, "utf8");

function fail(message) {
  throw new Error(`Voice artifact retention contract: ${message}`);
}

function requireFragments(source, label, fragments) {
  for (const fragment of fragments) {
    if (!source.includes(fragment)) fail(`${label} omits ${fragment}`);
  }
}

requireFragments(migration, "migration", [
  "private.voice_artifact_purge_runs",
  "private.try_parse_voice_retention_deadline",
  "private.purge_expired_voice_artifact_batch",
  "p_batch_size < 1 OR p_batch_size > 500",
  "pg_try_advisory_xact_lock",
  "SET lock_timeout = '5s'",
  "SET statement_timeout = '2min'",
  "FOR UPDATE OF m, c SKIP LOCKED",
  "c.channel = 'voice'",
  "c.organization_id IS NOT NULL",
  "c.organization_id = p_organization_id",
  "m.ai_metadata ->> 'provider_call_id' = c.session_token",
  "m.ai_metadata ->> 'source' IN ('controller', 'end_of_call')",
  "private.try_parse_voice_retention_deadline(",
  "DELETE FROM public.chat_messages AS m",
  "GET STACKED DIAGNOSTICS v_error_code = RETURNED_SQLSTATE",
  "'skipped_concurrent'",
  "'bluladder-voice-artifact-retention-purge'",
  "$cron$SELECT private.purge_expired_voice_artifact_batch(500, NULL);$cron$",
  "REVOKE ALL ON FUNCTION private.purge_expired_voice_artifact_batch(integer, uuid)",
]);

const deleteTargets = [
  ...migration.matchAll(/\bDELETE\s+FROM\s+([a-z_]+\.[a-z_]+)/gi),
].map((match) => match[1].toLowerCase());
if (
  deleteTargets.length !== 1 ||
  deleteTargets[0] !== "public.chat_messages"
) {
  fail(`unexpected delete targets: ${deleteTargets.join(", ") || "none"}`);
}

for (
  const forbidden of [
    /\bTRUNCATE\b/i,
    /\bSECURITY\s+DEFINER\b/i,
    /\b(?:UPDATE|DELETE\s+FROM)\s+cron\.job\b/i,
    /\bnet\.http_/i,
    /\b(?:DELETE\s+FROM|TRUNCATE)\s+public\.(?:chat_conversations|quote_sessions|quotes|customers|properties|bookings|sms_messages)\b/i,
    /VOICE_LIVE_BOOKING_ENABLED/i,
  ]
) {
  if (forbidden.test(migration)) {
    fail(`migration matches forbidden ${forbidden}`);
  }
}

const metricsTable = migration.match(
  /CREATE TABLE IF NOT EXISTS private\.voice_artifact_purge_runs[\s\S]*?\n\);/,
)?.[0] ?? "";
for (
  const sensitiveColumn of [
    /\bcontent\b/i,
    /\btranscript\b/i,
    /\bphone\b/i,
    /\bemail\b/i,
    /\baddress\b/i,
    /\bprovider_payload\b/i,
    /\bcredential\b/i,
    /\berror_message\b/i,
  ]
) {
  if (sensitiveColumn.test(metricsTable)) {
    fail(`metrics table contains sensitive field ${sensitiveColumn}`);
  }
}

requireFragments(rehearsal, "PostgreSQL rehearsal", [
  "expired eligible rows deleted",
  "unexpired row was deleted",
  "unrelated message was deleted",
  "cross-tenant isolation failed",
  "idempotent retry failed",
  "batch boundary failed",
  "failure rollback did not preserve the row",
  "malformed retention marker was deleted",
  "null retention marker was deleted",
  "skipped_concurrent",
]);

requireFragments(runbook, "release runbook", [
  "VOICE_LIVE_BOOKING_ENABLED=false",
  "Fresh hosted preflight",
  "checksum-pinned Lovable control path",
  "Verify the bounded purge",
  "Deploy the two voice Edge bundles",
  "Reconcile the Vapi manifest",
  "one controlled paid call",
  "Nova-3",
  "AssemblyAI",
  "Raw recording: disabled",
  "PCAP: disabled",
]);

requireFragments(manifest, "Vapi manifest", [
  "autoFallback: { enabled: false }",
  'provider: "assembly-ai"',
  'speechModel: "universal-streaming-english"',
  "vadAssistedEndpointingEnabled: true",
  "recordingEnabled: false",
  "videoRecordingEnabled: false",
  "pcapEnabled: false",
  "loggingEnabled: false",
  "fullMessageHistoryEnabled: false",
  "transcriptPlan: { enabled: false }",
]);
requireFragments(provisioning, "Vapi provisioning runbook", [
  "owner declined Vapi's paid Zero Data Retention add-on",
  "not equivalent to organization-level ZDR",
  "Automatic implicit fallback is disabled",
  "vadAssistedEndpointingEnabled: true",
  "Operational call metadata may remain",
]);

if (/autoFallback:\s*\{\s*enabled:\s*true\s*\}/.test(manifest)) {
  fail("Vapi manifest enables unreviewed automatic transcriber fallback");
}

requireFragments(preflight, "hosted preflight", [
  "BEGIN TRANSACTION READ ONLY",
  "canonical_expired_eligible",
  "voice_parent_missing_organization",
  "provider_session_mismatch",
  "null_retention_marker",
  "malformed_retention_marker",
  "transactions_open_over_five_minutes",
  "ROLLBACK",
]);
requireFragments(postflight, "hosted postflight", [
  "BEGIN TRANSACTION READ ONLY",
  "exact_active_job_rows",
  "private_schema_unavailable_to_api_roles",
  "purge_unavailable_to_api_roles",
  "canonical_expired_remaining",
  "batch_limit_violations",
  "metric_consistency_violations",
  "ROLLBACK",
]);

for (const verification of [preflight, postflight]) {
  if (
    /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i.test(
      verification,
    )
  ) {
    fail("hosted verification SQL is not read-only");
  }
  if (
    /\bSELECT\s+(?:m\.)?(?:content|session_token|provider_call_id)\b/i.test(
      verification,
    )
  ) {
    fail("hosted verification projects an artifact or provider identifier");
  }
}

if (!stage7bChecker.includes(migrationPath)) {
  fail("Stage 7B exact post-runtime migration review omits this migration");
}
if (
  !ci.includes("check:voice-artifact-retention-contract") ||
  !ci.includes("check:voice-artifact-retention-lovable-release") ||
  !ci.includes("rehearse-voice-artifact-retention-postgres.sh") ||
  !ci.includes("rehearse-voice-artifact-retention-lovable-postgres.sh") ||
  !ci.includes("github.event.pull_request.head.sha || github.sha")
) {
  fail("exact-head CI omits retention contract or PostgreSQL rehearsal");
}

console.log(
  "Voice artifact retention contract passed: one tenant-backed chat_messages " +
    "delete target, strict deadlines, bounded locking, private metrics, one " +
    "pg_cron job, disposable rehearsal, Vapi content retention disabled, " +
    "and reviewed transcriber fallback enforced.",
);
