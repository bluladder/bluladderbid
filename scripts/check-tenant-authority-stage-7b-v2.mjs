import fs from "node:fs";
import { execFileSync } from "node:child_process";

const migrationPath =
  "supabase/migrations/20260801164000_tenant_authority_stage_7b_v2.sql";
const migration = fs.readFileSync(migrationPath, "utf8");
// PR #66 is the runtime activation tranche built directly on the verified
// post-remediation main head. This pin makes the release boundary reviewable:
// the migration and canonical quote/pricing contracts must not drift, while
// only the enumerated Edge runtime and reviewed post-activation pricing files
// may change. The multi-service readiness repair deliberately updates both
// mirrored engines without changing migration history or pricing formulas.
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
  "supabase/migrations/20260802043233_voice_artifact_retention_purge.sql",
  // Lovable-generated execution twin of the reviewed canonical retention
  // migration 20260802043233. Definitively committed in production as
  // execution version 20260802143334 with payload SHA-256
  // 7c55e5f1389c6003a81dc6951629f9db2fed5416afe4e18c1f2081eda8d92530 and
  // matching production provenance (see
  // docs/releases/voice-artifact-retention-lovable-v1/evidence.json).
  "supabase/migrations/20260802143334_ece8e99d-b64a-4c85-ae68-869db62f2b8f.sql",
  // Issue #96: additive, fail-closed tenant binding for the existing operator
  // recipient table. The migration aborts rather than guessing once any
  // active non-DFW organization exists.
  "supabase/migrations/20260810150000_voice_escalation_recipients_tenant_scope.sql",
  // Phase 1C: reviewed inactive Klamath foundation. This migration provisions
  // no members, provider mappings, runtime routing, published site, customer
  // traffic, or enabled pricing.
  "supabase/migrations/20260813223348_bluladder_klamath_phase_1c_inactive_foundation.sql",
  // Forward compatibility repair for the genuinely unapplied historical
  // Stage 8A payload. It preserves the hardened helper-free tenant boundary.
  "supabase/migrations/20260814022314_bluladder_klamath_stage_8a_hosted_compatibility.sql",
  // Lovable-generated execution receipt for the exact reviewed Stage 8A
  // compatibility payload. The hosted-compatibility checker pins both payload
  // hashes and permits only the observed terminal-LF normalization.
  "supabase/migrations/20260814035656_f333948e-a5c5-4e5a-9958-b4ed1ee77dc2.sql",
  // Forward-only least-privilege repair for the authenticated table grants
  // hydrated by hosted defaults during the Stage 8A application.
  "supabase/migrations/20260814041512_bluladder_klamath_stage_8a_authenticated_grants.sql",
  // Lovable-generated receipt for the exact grant-repair payload, with only
  // the provider's terminal-LF normalization permitted by the hosted checker.
  "supabase/migrations/20260814045913_a2d7679c-4504-469d-87a5-f6c21edbfa97.sql",
  // Lovable-generated receipt for the exact inactive Phase 1C payload, with
  // only the provider's terminal-LF normalization permitted by its checker.
  "supabase/migrations/20260814050336_e5e2c901-cd2c-479c-a5be-71746296fd9b.sql",
  // Phase 1F: additive, fail-closed customer portal lineage. Hosted application
  // and runtime deployment remain separately gated.
  "supabase/migrations/20260814060000_bluladder_klamath_phase_1f_portal_tenant_lineage.sql",
  // Lovable-generated execution receipt for the exact Phase 1F portal-lineage
  // payload. The Phase 1F checker permits only terminal-LF normalization.
  "supabase/migrations/20260814062249_8cd57ad4-d1ad-47eb-8477-7af1a1401981.sql",
  // Phase 1G: additive messaging connector registry and nullable SMS lineage.
  // It creates no connector, changes no provider, and keeps Klamath inactive.
  "supabase/migrations/20260814070000_bluladder_klamath_phase_1g_additive_messaging_lineage.sql",
  // Lovable-generated receipt for the exact Phase 1G additive messaging
  // payload, with only terminal-LF normalization.
  "supabase/migrations/20260814071137_982fc4c4-f1d6-479d-84f4-26a2a8f845ff.sql",
  // Forward-only least-privilege repair for Lovable-hydrated structural grants
  // on the Phase 1G messaging connector registry.
  "supabase/migrations/20260814071600_bluladder_klamath_phase_1g_authenticated_grants.sql",
  "supabase/migrations/20260814072713_83b1f9da-ae78-4e2e-817a-09c40f2388a4.sql",
  "supabase/migrations/20260814074000_bluladder_klamath_phase_1g_scoped_sms_outbox.sql",
  "supabase/migrations/20260814081254_c3fdd8e6-ea9b-4220-a90b-5c1e8409be5d.sql",
  // Phase 1G: one exact DFW compatibility connector and bounded historical
  // ledger binding. Klamath remains provisioning without a connector.
  "supabase/migrations/20260814085000_bluladder_klamath_phase_1g_dfw_connector_compatibility.sql",
  // Lovable-generated receipt for the exact DFW connector payload, with only
  // terminal-LF normalization permitted by the Phase 1G checker.
  "supabase/migrations/20260814090619_8c3ae55b-db39-4ff8-ba3c-ad87f135b7b0.sql",
  // Phase 1H: organization-scoped consent and audit lineage. Hosted
  // application and all Klamath runtime adoption remain separately gated.
  "supabase/migrations/20260814102000_bluladder_klamath_phase_1h_organization_consent_lineage.sql",
  // Lovable-generated receipt for the exact Phase 1H payload, with only
  // terminal-LF normalization permitted by the Phase 1H checker.
  "supabase/migrations/20260814101915_76201d6e-142c-4edc-a852-93d63f5e6114.sql",
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
  "supabase/functions/_shared/buildMarker.ts",
  "supabase/functions/_shared/buildMarker_test.ts",
  "supabase/functions/_shared/aiTools.ts",
  "supabase/functions/_shared/availabilityLookup.ts",
  "supabase/functions/_shared/availabilityLookup_test.ts",
  "supabase/functions/_shared/bookingDuration.ts",
  "supabase/functions/_shared/bookingDuration_test.ts",
  "supabase/functions/_shared/bookingReadiness.ts",
  "supabase/functions/_shared/bookingReadiness_test.ts",
  "supabase/functions/_shared/callrailEventProcessor.ts",
  "supabase/functions/_shared/deterministicUuid.ts",
  "supabase/functions/_shared/discountCodeValidation.ts",
  "supabase/functions/_shared/discountCodeValidation_test.ts",
  "supabase/functions/_shared/executeSmsBooking.ts",
  "supabase/functions/_shared/handleConfirmationReply.ts",
  "supabase/functions/_shared/handleConfirmationReply_expired_test.ts",
  "supabase/functions/_shared/escalation.ts",
  "supabase/functions/_shared/escalation_test.ts",
  "supabase/functions/_shared/escalationDelivery.ts",
  "supabase/functions/_shared/escalationDelivery_test.ts",
  "supabase/functions/_shared/smsOutbox.ts",
  "supabase/functions/_shared/smsOutbox_test.ts",
  "supabase/functions/_shared/customerPortalAppointments.ts",
  "supabase/functions/_shared/customerPortalAppointments_test.ts",
  "supabase/functions/_shared/identityAnchor.ts",
  "supabase/functions/_shared/identityAnchor_test.ts",
  "supabase/functions/_shared/jobberClient.ts",
  "supabase/functions/_shared/jobberClientMutation_test.ts",
  "supabase/functions/_shared/organizationCustomerSites.ts",
  "supabase/functions/_shared/organizationCustomerSites_test.ts",
  "supabase/functions/_shared/organizationAuthority.ts",
  "supabase/functions/_shared/organizationAuthority_test.ts",
  "supabase/functions/_shared/ownerNotifications.ts",
  "supabase/functions/_shared/ownerNotifications_test.ts",
  "supabase/functions/_shared/profile/normalizeAddress.ts",
  "supabase/functions/_shared/profile/normalizeAddress_test.ts",
  "supabase/functions/_shared/publicBookingCustomer.ts",
  "supabase/functions/_shared/publicBookingCustomer_test.ts",
  "supabase/functions/_shared/publicBookingRelease_contract_test.ts",
  "supabase/functions/_shared/publicRequestReplay.ts",
  "supabase/functions/_shared/publicRequestReplay_test.ts",
  "supabase/functions/_shared/pricingEngine.ts",
  "supabase/functions/_shared/quoteSession.ts",
  "supabase/functions/_shared/quoteSession_test.ts",
  "supabase/functions/_shared/salesEngine/residentialQuoteManifest.ts",
  "supabase/functions/_shared/supabaseOrganizationAuthority.ts",
  "supabase/functions/_shared/supabaseOrganizationAuthority_test.ts",
  "supabase/functions/_shared/suppression.ts",
  "supabase/functions/_shared/suppression_test.ts",
  "supabase/functions/_shared/voice/controllerRoute.ts",
  "supabase/functions/_shared/voice/controllerRoute_test.ts",
  "supabase/functions/_shared/voice/voiceControllerStream.ts",
  "supabase/functions/_shared/voice/voiceControllerStream_test.ts",
  "supabase/functions/_shared/voice/hangupBidLinkFollowup.ts",
  "supabase/functions/_shared/voice/hangupBidLinkFollowup_test.ts",
  "supabase/functions/_shared/voice/voiceCallLinkIdentity.ts",
  "supabase/functions/_shared/voice/voiceEscalationRecipientTenantMigration_test.ts",
  "supabase/functions/_shared/voice/voiceHumanTransfer.ts",
  "supabase/functions/_shared/voice/voiceHumanTransfer_test.ts",
  "supabase/functions/_shared/voice/voiceLinkTools.ts",
  "supabase/functions/_shared/voice/voiceLinkTools_test.ts",
  "supabase/functions/_shared/voice/postCallOperationalNote.ts",
  "supabase/functions/_shared/voice/postCallOperationalNote_test.ts",
  "supabase/functions/_shared/voice/quoteByTextDelivery.ts",
  "supabase/functions/_shared/voice/quoteByTextDelivery_test.ts",
  "supabase/functions/_shared/voice/quoteByText.ts",
  "supabase/functions/_shared/voice/quoteByText_test.ts",
  "supabase/functions/_shared/voice/quoteDeliveryIdentity.ts",
  "supabase/functions/_shared/voice/quoteDeliveryIdentity_test.ts",
  "supabase/functions/_shared/voice/quoteSessionProjection.ts",
  "supabase/functions/_shared/voice/quoteSessionProjection_test.ts",
  "supabase/functions/_shared/voice/spokenEmail.ts",
  "supabase/functions/_shared/voice/spokenEmail_test.ts",
  "supabase/functions/_shared/voice/spokenQuantity.ts",
  "supabase/functions/_shared/voice/spokenQuantity_test.ts",
  "supabase/functions/_shared/voice/turnJournal.ts",
  "supabase/functions/_shared/voice/vapiArtifactJournal.ts",
  "supabase/functions/_shared/voice/vapiArtifactJournal_test.ts",
  "supabase/functions/_shared/voice/voiceAddressGate.ts",
  "supabase/functions/_shared/voice/voiceBookingIdentityPreparation.ts",
  "supabase/functions/_shared/voice/voiceBookingIdentityPreparation_test.ts",
  "supabase/functions/_shared/voice/voiceCanonicalIntake.ts",
  "supabase/functions/_shared/voice/voiceInputNormalizer.ts",
  "supabase/functions/_shared/voice/voiceInputNormalizer_test.ts",
  "supabase/functions/_shared/voice/voiceJourneyContract.ts",
  "supabase/functions/_shared/voice/voiceJourneyCompletion_test.ts",
  "supabase/functions/_shared/voice/voicePolicy.ts",
  "supabase/functions/_shared/voice/voicePolicy_test.ts",
  "supabase/functions/_shared/voice/voiceOrganizationAuthority.ts",
  "supabase/functions/_shared/voice/voiceOrganizationAuthority_test.ts",
  "supabase/functions/_shared/voice/voiceRemediation67_test.ts",
  "supabase/functions/_shared/voice/voiceRemediation68_test.ts",
  "supabase/functions/_shared/voice/voiceTurnCoordinator.ts",
  "supabase/functions/_shared/voice/voiceTurnCoordinator_test.ts",
  "supabase/functions/_shared/voice/voiceTurnLatency.ts",
  "supabase/functions/_shared/voice/voiceTurnLatency_test.ts",
  "supabase/functions/_shared/voice/voiceTurnReplay.ts",
  "supabase/functions/_shared/voice/voiceTurnReplay_test.ts",
  "supabase/functions/_shared/voice/voiceDeliveryState.ts",
  "supabase/functions/_shared/voiceAdapter.ts",
  "supabase/functions/_shared/voiceAdapter_streaming_test.ts",
  "supabase/functions/_shared/voiceAdapter_test.ts",
  "supabase/functions/_shared/voiceBookingAdapter.ts",
  "supabase/functions/_shared/voiceBookingAdapter_test.ts",
  "supabase/functions/_shared/quoteSessionPricingAdapter.ts",
  "supabase/functions/_shared/queueDelivery_contract_test.ts",
  "supabase/functions/_shared/queuedSmsConnector.ts",
  "supabase/functions/_shared/queuedSmsConnector_test.ts",
  "supabase/functions/_shared/voiceBookingDryRun_test.ts",
  "supabase/functions/_shared/voiceLiveBooking_test.ts",
  "supabase/functions/_shared/voiceProviderConfig.ts",
  "supabase/functions/_shared/voiceProviderConfig_test.ts",
  "supabase/functions/_shared/voiceProviderEndCallPhrases_test.ts",
  "supabase/functions/_shared/voiceProviderReconciliation.ts",
  "supabase/functions/_shared/voiceProviderReconciliation_test.ts",
  "supabase/functions/_shared/voiceTransferResolver.ts",
  "supabase/functions/_shared/voiceTransferResolver_test.ts",
  "supabase/functions/_shared/conversationContext.ts",
  "supabase/functions/_shared/customerVerification.ts",
  "supabase/functions/_shared/messagingConnectorContracts.ts",
  "supabase/functions/_shared/messagingConnectorContracts_test.ts",
  "supabase/functions/_shared/twilioSms.ts",
  "supabase/functions/_shared/twilioSms_test.ts",
  "supabase/functions/_shared/portalOrganizationAuthority.ts",
  "supabase/functions/_shared/portalOrganizationAuthority_test.ts",
  "supabase/functions/_shared/organizationConsent.ts",
  "supabase/functions/_shared/organizationConsent_test.ts",
  "supabase/functions/_shared/organizationConsentRuntime_contract_test.ts",
  "supabase/functions/_shared/workflow/callerIdConfirmation.ts",
  "supabase/functions/_shared/workflow/callerIdConfirmation_test.ts",
  "supabase/functions/_shared/workflow/customerResolver.ts",
  "supabase/functions/_shared/workflow/customerResolver_test.ts",
  "supabase/functions/_shared/workflow/residentialQuote_test.ts",
  "supabase/functions/_shared/workflow/workflowController.ts",
  "supabase/functions/_shared/workflow/workflowController_rollout_test.ts",
  "supabase/functions/_shared/workflow/rolloutRoute.ts",
  "supabase/functions/_shared/workflow/rolloutRoute_test.ts",
  "supabase/functions/_shared/workflow/workflowSession.ts",
  "supabase/functions/_shared/workflow/workflows/residentialQuote.ts",
  "supabase/functions/attribution-ingest/index.ts",
  "supabase/functions/jobber-create-booking/index.ts",
  "supabase/functions/jobber-create-booking/launch_safety_test.ts",
  "supabase/functions/customer-portal-data/index.ts",
  "supabase/functions/customer-portal-data-authed/index.ts",
  "supabase/functions/customer-access-live-test/index.ts",
  "supabase/functions/customer-auth-link/index.ts",
  "supabase/functions/customer-verification-confirm/index.ts",
  "supabase/functions/customer-verification-request/index.ts",
  "supabase/functions/customer-verification-request/outbox_contract_test.ts",
  "supabase/functions/ai-chat/index.ts",
  "supabase/functions/process-sms-queue/index.ts",
  "supabase/functions/staff-reply/index.ts",
  "supabase/functions/manage-sms-optout/index.ts",
  "supabase/functions/send-sms/index.ts",
  "supabase/functions/escalation-test-notify/index.ts",
  "supabase/functions/voice-llm-adapter/index.ts",
  "supabase/functions/validate-discount-code/index.ts",
  "supabase/functions/validate-discount-code/shared_validator_contract_test.ts",
  "supabase/functions/voice-vapi-events/index.ts",
  "supabase/functions/voice-vapi-events/index_test.ts",
]);
const changedEdgePaths = changedPaths(["supabase/functions"]);
// Main already carried this Lovable-generated MCP bundle before PR #80. Keep
// that inherited drift separate from the voice-policy review and pin the exact
// Lovable SDK 0.20.1 regeneration so this exception cannot silently authorize
// a later MCP regeneration.
const inheritedEdgeBlobs = new Map([
  [
    "supabase/functions/mcp/index.ts",
    "ff48f6ebdafd458a10e8bef2aac1309c5feb3761",
  ],
]);
for (const [path, expectedBlob] of inheritedEdgeBlobs) {
  const actualBlob = execFileSync("git", ["rev-parse", `HEAD:${path}`], {
    encoding: "utf8",
  }).trim();
  if (actualBlob !== expectedBlob) {
    throw new Error(
      `inherited Edge path changed outside its reviewed blob pin: ${path}`,
    );
  }
}
const unexpectedEdgePaths = changedEdgePaths.filter((path) =>
  !allowedEdgePaths.has(path) && !inheritedEdgeBlobs.has(path)
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
  // Exact owner-call prompt-only repair. These two synchronized manifests
  // change no intake fields, pricing inputs, rates, tax, totals, or duration.
  "packages/sales-engine/intake/residentialQuoteManifest.ts",
  "packages/sales-engine/intake/residentialQuoteManifest.test.ts",
  "src/lib/pricing/__fixtures__/legacyBundlePricing.ts",
  "src/lib/pricing/__fixtures__/liveConfig.ts",
  "src/lib/pricing/engine.ts",
  "src/lib/pricing/engine.planOptions.test.ts",
  "src/lib/pricing/engine.test.ts",
  "src/lib/pricing/fromQuoteResult.ts",
  "src/lib/pricing/fromQuoteResult.test.ts",
  "src/lib/pricing/gutterBasePricing.regression.test.ts",
  "src/lib/pricing/houseWashPricing.regression.test.ts",
  "src/lib/pricing/multiserviceQuoteReadiness.regression.test.ts",
  "src/lib/pricing/quoteIntegrity.ts",
  "src/lib/pricing/toQuoteInput.ts",
  "src/lib/pricing/toQuoteInput.selectedServices.test.ts",
  "supabase/functions/_shared/pricingEngine.ts",
  "supabase/functions/_shared/quoteSessionPricingAdapter.ts",
  "supabase/functions/_shared/salesEngine/residentialQuoteManifest.ts",
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

for (
  const fragment of [
    "voice_escalation_recipient_rehearsal",
    "VOICE_ESCALATION_RECIPIENT_DATABASE_URL",
    "rehearse-voice-escalation-recipients-postgres.sh",
  ]
) {
  if (!ciWorkflow.includes(fragment)) {
    throw new Error(`CI omits voice operator tenant rehearsal: ${fragment}`);
  }
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
    "reviewed pricing/readiness changes allowlisted; exact Edge allowlist, " +
    "hashed provider authority, ingress ordering, and fail-closed gates intact.",
);
