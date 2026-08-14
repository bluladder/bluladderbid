import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const paths = {
  evidence:
    "docs/operations/bluladder-klamath-jobtread-phase1i-webhook-receipt-gates.json",
  docs:
    "docs/architecture/bluladder-klamath-jobtread-phase1i-webhook-receipts.md",
  source:
    "supabase/functions/_shared/jobtreadPhase1IWebhookReceipts.ts",
  tests:
    "supabase/functions/_shared/jobtreadPhase1IWebhookReceipts_test.ts",
  schema:
    "supabase/migrations/20260814113000_bluladder_klamath_phase_1i_crm_connector_lineage.sql",
};
const contents = {};
const errors = [];
for (const [key, relative] of Object.entries(paths)) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) errors.push(`missing ${relative}`);
  else contents[key] = fs.readFileSync(full, "utf8");
}

let evidence;
try {
  evidence = JSON.parse(contents.evidence ?? "{}");
} catch (error) {
  errors.push(`invalid Phase 1I receipt evidence: ${error.message}`);
}

if (evidence?.store_version !== 1) errors.push("store version must be one");
if (evidence?.receipt_table !==
  "organization_connector_webhook_receipts") {
  errors.push("receipt table drifted");
}
for (const flag of [
  "exact_bounded_selects",
  "organization_connector_scoped",
  "source_authentication_proof_required",
  "direct_insert_required_for_claim",
  "ambiguous_insert_recovery_read_only",
  "fingerprint_conflict_fails_closed",
  "accepted_receipt_blocks_duplicate_processing",
  "terminal_receipt_blocks_duplicate_processing",
  "accepted_only_terminal_transition",
  "terminal_transition_tenant_scoped",
  "provider_events_persisted_as_hashes_only",
  "reconciliation_read_only",
  "postgrest_errors_redacted",
  "credential_created",
  "provider_resources_mutated",
]) {
  if (evidence?.[flag] !== true) errors.push(`${flag} must be true`);
}
for (const flag of [
  "raw_payload_accepted",
  "raw_secret_accepted",
  "ambiguous_insert_grants_processing",
  "runtime_entrypoint_adopted",
  "webhook_authentication_implemented",
  "credential_configured",
  "credential_verified",
  "credential_value_stored_in_repository",
  "webhook_created",
  "connector_row_created",
  "provider_events_received",
  "hosted_mutation_performed",
  "deployment_performed",
  "activation_allowed",
  "customer_traffic_allowed",
  "jobber_or_dfw_fallback_allowed",
]) {
  if (evidence?.[flag] !== false) errors.push(`${flag} must remain false`);
}

for (const phrase of [
  "JOBTREAD_PHASE1I_WEBHOOK_RECEIPT_STORE_VERSION = 1",
  "organization_connector_webhook_receipts",
  "JOBTREAD_WEBHOOK_RECEIPT_SELECT",
  "sourceAuthenticated: true",
  "providerEventHash",
  "payloadFingerprint",
  "selectExactReceipt",
  "status: \"in_progress\"",
  "status: \"duplicate\"",
  "status: \"conflict\"",
  ".eq(\"organization_id\", input.organizationId)",
  ".eq(\"connector_id\", input.connectorId)",
  ".eq(\"status\", \"accepted\")",
  ".is(\"processed_at\", null)",
  "JobTreadWebhookReceiptReconciliationResult",
]) {
  if (!contents.source?.includes(phrase)) {
    errors.push(`receipt source omits: ${phrase}`);
  }
}
for (const forbidden of [
  "Deno.env",
  "createClient(",
  "fetch(",
  "setTimeout(",
  "grantKey",
  "authorization",
  "webhookSecret",
  "requestBody",
  "rawPayload",
]) {
  if (contents.source?.includes(forbidden)) {
    errors.push(`receipt store must keep side effects and raw authority absent: ${forbidden}`);
  }
}
const claimInterface = contents.source?.match(
  /export interface JobTreadWebhookReceiptClaim \{([\s\S]*?)\n\}/,
)?.[1] ?? "";
for (const forbidden of [
  "payload:",
  "headers",
  "token",
  "secret",
  "retry",
  "status",
  "failureCode",
]) {
  if (claimInterface.includes(forbidden)) {
    errors.push(`receipt claim may not accept ${forbidden}`);
  }
}
for (const phrase of [
  "owns processing only after the exact direct insert",
  "rejects unauthenticated or malformed authority before storage",
  "never turns an ambiguous insert into processing ownership",
  "fails closed when an ambiguous insert has no exact row",
  "accepted-only conditional transitions",
  "admits only schema-approved failure codes",
  "reconciliation is read-only, bounded, and sanitized",
  "redacts thrown insert and recovery failures",
]) {
  if (!contents.tests?.includes(phrase)) {
    errors.push(`receipt tests omit: ${phrase}`);
  }
}
if (/Deno\.test\.ignore|\.skip\(/.test(contents.tests ?? "")) {
  errors.push("receipt tests may not be skipped");
}
for (const phrase of [
  "No production Edge entry point imports it",
  "There is no raw payload",
  "never grants ownership",
  "filters all three",
  "Reconciliation is read-only",
  "There is no Jobber or DFW fallback",
]) {
  if (!contents.docs?.includes(phrase)) {
    errors.push(`receipt docs omit: ${phrase}`);
  }
}
for (const phrase of [
  "organization_connector_webhook_receipts",
  "provider_event_hash",
  "payload_fingerprint",
  "source_authenticated boolean NOT NULL CHECK (source_authenticated)",
  "UNIQUE (connector_id, provider_event_hash)",
  "status IN ('accepted', 'processed', 'ignored', 'manual_review')",
]) {
  if (!contents.schema?.includes(phrase)) {
    errors.push(`Phase 1I receipt schema contract missing: ${phrase}`);
  }
}

const functionRoot = path.join(root, "supabase/functions");
const productionImports = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".ts") &&
      full !== path.join(root, paths.source) &&
      full !== path.join(root, paths.tests) &&
      fs.readFileSync(full, "utf8").includes(
        "jobtreadPhase1IWebhookReceipts",
      )) {
      productionImports.push(path.relative(root, full));
    }
  }
}
walk(functionRoot);
if (productionImports.length) {
  errors.push(`Phase 1I receipt store became reachable from: ${productionImports.join(", ")}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "Klamath JobTread Phase 1I receipt store OK: authenticated hash-only claim, fail-closed ambiguity recovery, tenant-scoped terminal transitions, and read-only reconciliation remain dormant.",
);
