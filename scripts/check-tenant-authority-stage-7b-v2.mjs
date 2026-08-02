import fs from "node:fs";
import { execFileSync } from "node:child_process";

const migrationPath =
  "supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
// PR #66 is the runtime activation tranche built directly on the verified
// post-remediation main head. This pin makes the release boundary reviewable:
// the migration and canonical quote/pricing contracts must not drift, while
// only the enumerated Edge runtime and regression-test files may change.
const runtimeBase = "77d0ad1eda042a403838c407b2318b7274bde8a3";
const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const secretScanWorkflow = fs.readFileSync(
  ".github/workflows/secret-scan.yml",
  "utf8",
);

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function changedPaths(pathspecs) {
  const output = execFileSync(
    "git",
    ["diff", "--name-only", runtimeBase, "--", ...pathspecs],
    { encoding: "utf8" },
  ).trim();
  return output ? output.split("\n") : [];
}

function requireFragments(path, fragments) {
  const source = read(path);
  for (const fragment of fragments) {
    if (!source.includes(fragment)) {
      throw new Error(`${path} omits runtime authority contract: ${fragment}`);
    }
  }
  return source;
}

for (
  const fragment of [
    "ADD COLUMN IF NOT EXISTS organization_id uuid",
    "IN SHARE ROW EXCLUSIVE MODE",
    "quote_sessions_organization_id_fkey",
    "chat_conversations_organization_id_fkey",
    "quote_sessions_organization_id_idx",
    "chat_conversations_organization_id_idx",
    "VALIDATE CONSTRAINT quote_sessions_organization_id_fkey",
    "VALIDATE CONSTRAINT chat_conversations_organization_id_fkey",
    "first-wave quote organization reconciliation required",
    "first-wave booking organization reconciliation required",
    "quote session organization backfill conflict",
    "conversation organization backfill conflict",
    "enforce_first_wave_organization_lineage",
    "enforce_session_organization_lineage",
    "old-runtime/new-schema transition",
    'CREATE POLICY "Tenant boundary quote sessions"',
    'CREATE POLICY "Tenant boundary chat conversations"',
    "AS RESTRICTIVE FOR ALL TO authenticated",
    "WITH CHECK",
    "security_invoker = true",
    "REVOKE ALL ON public.quote_sessions, public.chat_conversations",
  ]
) {
  if (!migration.includes(fragment)) {
    throw new Error(`Stage 7B v2 migration omits: ${fragment}`);
  }
}

if (/organization_id\s+uuid\s+DEFAULT/i.test(migration)) {
  throw new Error("Stage 7B v2 must not install an organization default");
}
if (/UPDATE[\s\S]{0,160}organization_id\s*=\s*['\"]b1addf00/i.test(migration)) {
  throw new Error("Stage 7B v2 must not blanket-backfill DFW");
}
if (/\b(?:DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE)\b/i.test(migration)) {
  throw new Error("Stage 7B v2 contains destructive DDL");
}
if (/SECURITY\s+DEFINER/i.test(migration)) {
  throw new Error("Stage 7B v2 must not add a security-definer function");
}

const migrationAtRuntimeBase = execFileSync(
  "git",
  ["show", `${runtimeBase}:${migrationPath}`],
  { encoding: "utf8" },
);
if (migration !== migrationAtRuntimeBase) {
  throw new Error(
    "Stage 7B v2 runtime activation must not modify the applied migration",
  );
}
const changedMigrationPaths = changedPaths(["supabase/migrations"]);
const reviewedPostRuntimeMigrations = new Set([
  "supabase/migrations/20260801234014_12e7ed78-5a9d-4985-8cb7-c9ab044dc165.sql",
]);
const unexpectedMigrationPaths = changedMigrationPaths.filter((path) =>
  !reviewedPostRuntimeMigrations.has(path)
);
if (unexpectedMigrationPaths.length) {
  throw new Error(
    `runtime-only release boundary violated by migration drift:\n${
      unexpectedMigrationPaths.join("\n")
    }`,
  );
}

const allowedEdgePaths = new Set([
  "supabase/functions/_shared/aiOrchestrator.ts",
  "supabase/functions/_shared/aiTools.ts",
  "supabase/functions/_shared/availabilityLookup.ts",
  "supabase/functions/_shared/availabilityLookup_test.ts",
  "supabase/functions/_shared/bookingReadiness.ts",
  "supabase/functions/_shared/bookingReadiness_test.ts",
  "supabase/functions/_shared/deterministicUuid.ts",
  "supabase/functions/_shared/identityAnchor.ts",
  "supabase/functions/_shared/identityAnchor_test.ts",
  "supabase/functions/_shared/organizationAuthority.ts",
  "supabase/functions/_shared/organizationAuthority_test.ts",
  "supabase/functions/_shared/quoteSession.ts",
  "supabase/functions/_shared/quoteSession_test.ts",
  "supabase/functions/_shared/supabaseOrganizationAuthority.ts",
  "supabase/functions/_shared/supabaseOrganizationAuthority_test.ts",
  "supabase/functions/_shared/voice/voiceOrganizationAuthority.ts",
  "supabase/functions/_shared/voice/voiceOrganizationAuthority_test.ts",
  "supabase/functions/_shared/voice/voiceRemediation68_test.ts",
  "supabase/functions/_shared/voiceAdapter.ts",
  "supabase/functions/_shared/voiceAdapter_streaming_test.ts",
  "supabase/functions/_shared/voiceAdapter_test.ts",
  "supabase/functions/_shared/voiceBookingDryRun_test.ts",
  "supabase/functions/_shared/voiceLiveBooking_test.ts",
  "supabase/functions/_shared/workflow/workflowController.ts",
  "supabase/functions/_shared/workflow/workflowController_rollout_test.ts",
  "supabase/functions/_shared/workflow/rolloutRoute.ts",
  "supabase/functions/_shared/workflow/rolloutRoute_test.ts",
  "supabase/functions/_shared/workflow/workflowSession.ts",
  "supabase/functions/attribution-ingest/index.ts",
  "supabase/functions/voice-llm-adapter/index.ts",
]);
const changedEdgePaths = changedPaths(["supabase/functions"]);
const unexpectedEdgePaths = changedEdgePaths.filter((path) =>
  !allowedEdgePaths.has(path)
);
if (unexpectedEdgePaths.length) {
  throw new Error(
    `runtime-only Edge allowlist violated:\n${unexpectedEdgePaths.join("\n")}`,
  );
}
const missingEdgePaths = [...allowedEdgePaths].filter((path) =>
  !changedEdgePaths.includes(path)
);
if (missingEdgePaths.length) {
  throw new Error(
    `runtime activation unexpectedly omits reviewed Edge changes:\n${
      missingEdgePaths.join("\n")
    }`,
  );
}

const reviewedPostRuntimeProtectedPaths = new Set([
  "src/lib/pricing/fromQuoteResult.test.ts",
]);
const protectedContractPaths = changedPaths([
  "packages/sales-engine",
  "src/lib/pricing",
  "supabase/functions/_shared/loadPricing.ts",
  "supabase/functions/_shared/partialWindowPricing.ts",
  "supabase/functions/_shared/partialWindowPricing_test.ts",
  "supabase/functions/_shared/pricingEngine.ts",
  "supabase/functions/_shared/pricingEngine_test.ts",
  "supabase/functions/_shared/pricingEngine.planBooking_test.ts",
  "supabase/functions/_shared/quoteSessionPricingAdapter.ts",
  "supabase/functions/_shared/quoteSessionPricingAdapter_test.ts",
  "supabase/functions/_shared/salesEngine",
]).filter((path) => !reviewedPostRuntimeProtectedPaths.has(path));
if (protectedContractPaths.length) {
  throw new Error(
    `canonical quote, pricing, tax, or duration contract drifted:\n${
      protectedContractPaths.join("\n")
    }`,
  );
}

const authoritySource = requireFragments(
  "supabase/functions/_shared/organizationAuthority.ts",
  [
    "value.trim()",
    'crypto.subtle.digest("SHA-256", bytes)',
    '.padStart(2, "0")',
    "normalizedMapped.length !== mapped.length",
    "result.signals.length !== normalizedMapped.length",
    'statuses.statuses[pure.organizationId] !== "active"',
  ],
);
const providerKeyBlock = authoritySource.match(
  /const PROVIDER_KEYS[\s\S]*?\]\);/,
)?.[0] ?? "";
if (
  !providerKeyBlock.includes('"vapi_assistant"') ||
  !providerKeyBlock.includes('"vapi_phone_number"') ||
  providerKeyBlock.includes('"email_address"')
) {
  throw new Error("provider authority key vocabulary is not fail-closed");
}

const supabaseAuthoritySource = requireFragments(
  "supabase/functions/_shared/supabaseOrganizationAuthority.ts",
  [
    'from("organization_resolution_keys")',
    '.eq("key_type", selector.keyType)',
    '.eq("key_hash", selector.keyHash)',
    '.eq("status", "active")',
    ".limit(2)",
  ],
);
if (
  /organization_resolution_keys[\s\S]{0,180}\.(?:insert|update|upsert)\s*\(/
    .test(supabaseAuthoritySource)
) {
  throw new Error(
    "runtime authority lookup must not persist provider identifiers",
  );
}

const voiceAuthoritySource = requireFragments(
  "supabase/functions/_shared/voice/voiceOrganizationAuthority.ts",
  [
    "rawBody?.assistant?.id",
    "rawBody?.assistantId",
    "rawBody?.call?.assistantId",
    "rawBody?.phoneNumber?.id",
    "rawBody?.phoneNumberId",
    "rawBody?.call?.phoneNumber?.id",
    "rawBody?.call?.phoneNumberId",
    'keyType: "vapi_assistant"',
    'keyType: "vapi_phone_number"',
  ],
);
for (
  const forbidden of [
    /rawBody\?\.organizationId/,
    /rawBody\?\.metadata/,
    /rawBody\?\.customer/,
    /rawBody\?\.call\?\.customer/,
    /rawBody\?\.email/,
  ]
) {
  if (forbidden.test(voiceAuthoritySource)) {
    throw new Error(
      `untrusted voice payload field entered tenant authority: ${forbidden}`,
    );
  }
}

const ingressSource = requireFragments(
  "supabase/functions/voice-llm-adapter/index.ts",
  [
    "resolveVoiceProviderOrganizationAuthority(",
    "ensureVoiceConversation({",
    "resolveVoiceOrganizationAuthority(",
    "organizationId: providerAuthority.organizationId",
    'reason: "organization_authority_blocked"',
    'reason: "organization_authority_reconciliation_blocked"',
  ],
);
const providerGateIndex = ingressSource.indexOf(
  "resolveVoiceProviderOrganizationAuthority(",
);
const conversationIndex = ingressSource.indexOf("ensureVoiceConversation({");
const reconciliationIndex = ingressSource.indexOf(
  "resolveVoiceOrganizationAuthority(",
);
if (
  providerGateIndex < 0 || conversationIndex <= providerGateIndex ||
  reconciliationIndex <= conversationIndex
) {
  throw new Error(
    "voice ingress must resolve provider authority before conversation access and then reconcile it",
  );
}

for (
  const [path, fragments] of Object.entries({
    "supabase/functions/_shared/voiceAdapter.ts": [
      "voice_organization_authority_required",
      '.eq("organization_id", organizationId)',
      "row.organization_id === organizationId",
      'deterministicUuid(\n    "voice-conversation"',
    ],
    "supabase/functions/_shared/quoteSession.ts": [
      'channel === "voice" && !organizationId',
      '.eq("organization_id", organizationId)',
      'deterministicUuid(\n      "quote-session"',
      "findByConversationStrict",
    ],
    "supabase/functions/_shared/workflow/workflowSession.ts": [
      'args.channel === "voice" && !organizationId',
      '.eq("organization_id", organizationId)',
    ],
    "supabase/functions/_shared/workflow/workflowController.ts": [
      'reason: "tenant_authority_required"',
      "__expected_organization_id: expectedOrganizationId",
    ],
    "supabase/functions/_shared/bookingReadiness.ts": [
      'code: "organization_context_unavailable"',
      "effectiveOrganizationId ===",
      'code: "organization_pricing_unavailable"',
      'status = "duration_unavailable"',
    ],
    "supabase/functions/_shared/availabilityLookup.ts": [
      'detail: "organization_context_mismatch"',
      '.eq("organization_id", expectedOrganizationId)',
      'detail: "provider_connector_unavailable_for_organization"',
      'detail: "booking_address_lineage_mismatch"',
      '"provider_slots_shorter_than_canonical_duration"',
    ],
    "supabase/functions/_shared/aiTools.ts": [
      'status: "tenant_authority_required"',
      'status: "organization_capability_unavailable"',
      '"stale_quote_identity"',
      '"slot_stale_not_in_latest_offer"',
      '"provider_accepted_local_outcome_uncertain"',
    ],
  })
) {
  requireFragments(path, fragments);
}

// CI must exercise the published PR head, not GitHub's synthetic merge tree.
const exactHeadCheckout = "github.event.pull_request.head.sha || github.sha";
if (
  !ciWorkflow.includes(exactHeadCheckout) ||
  !secretScanWorkflow.includes(exactHeadCheckout)
) {
  throw new Error("CI or secret scan does not checkout the exact PR head");
}

// Repository automation may rehearse migrations, but it may not publish or
// apply them. Lovable synchronization is therefore treated as an external
// release boundary, never as an ordering guarantee.
for (
  const forbidden of [
    /supabase\s+db\s+push/i,
    /supabase\s+functions\s+deploy/i,
    /supabase\s+migration\s+up/i,
    /vercel\s+(?:deploy|--prod)/i,
    /lovable[_ -]deploy/i,
  ]
) {
  if (forbidden.test(`${ciWorkflow}\n${secretScanWorkflow}`)) {
    throw new Error(
      `automatic release command entered GitHub Actions: ${forbidden}`,
    );
  }
}

console.log(
  "Stage 7B v2 runtime-activation check passed: applied migration and " +
    "canonical quote/pricing contracts unchanged; exact Edge allowlist, " +
    "hashed provider authority, ingress ordering, and fail-closed gates intact.",
);
