export const JOBTREAD_FIRST_WAVE_INBOUND_POLICY_VERSION = 1;

export interface JobTreadFirstWaveInboundPolicy {
  schemaVersion: 1;
  mode: "server_initiated_only";
  webhookEnabled: false;
  webhookSecretReferencePresent: false;
  publicWebhookRouteEnabled: false;
  providerPayloadAccepted: false;
  providerEventAuthorityAccepted: false;
  liveAvailabilityReadRequired: true;
  providerInitiatedChanges: "operator_dual_entry_manual_review";
  operationAttemptMode: "hashed_single_attempt";
  mutationAutoRetryAllowed: false;
  ambiguousMutationRequiresReconciliation: true;
}

export interface JobTreadFirstWaveInboundPolicyResult {
  status: "blocked" | "ready_for_separate_runtime_review";
  activationAllowed: false;
  blockers: readonly string[];
}

/**
 * First-launch JobTread ingress is intentionally absent. BluLadder may make
 * separately authorized server-to-server reads and writes, but an unsigned
 * provider webhook can never become organization, event, or mutation
 * authority. The future authenticated receipt store remains unreachable.
 */
export const JOBTREAD_FIRST_WAVE_SERVER_INITIATED_POLICY:
  JobTreadFirstWaveInboundPolicy = Object.freeze({
    schemaVersion: 1,
    mode: "server_initiated_only",
    webhookEnabled: false,
    webhookSecretReferencePresent: false,
    publicWebhookRouteEnabled: false,
    providerPayloadAccepted: false,
    providerEventAuthorityAccepted: false,
    liveAvailabilityReadRequired: true,
    providerInitiatedChanges: "operator_dual_entry_manual_review",
    operationAttemptMode: "hashed_single_attempt",
    mutationAutoRetryAllowed: false,
    ambiguousMutationRequiresReconciliation: true,
  });

const POLICY_KEYS = new Set([
  "schemaVersion",
  "mode",
  "webhookEnabled",
  "webhookSecretReferencePresent",
  "publicWebhookRouteEnabled",
  "providerPayloadAccepted",
  "providerEventAuthorityAccepted",
  "liveAvailabilityReadRequired",
  "providerInitiatedChanges",
  "operationAttemptMode",
  "mutationAutoRetryAllowed",
  "ambiguousMutationRequiresReconciliation",
]);
const SENSITIVE_FIELD_PATTERN =
  /(?:token|password|api.?key|grant.?key|header|provider.?id|account.?id|organization.?id|event.?id|phone|email|url|payload|secret)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function evaluateJobTreadFirstWaveInboundPolicy(
  input: unknown,
): JobTreadFirstWaveInboundPolicyResult {
  const blockers: string[] = [];
  if (!isRecord(input)) {
    return {
      status: "blocked",
      activationAllowed: false,
      blockers: ["invalid_policy_shape"],
    };
  }

  for (const key of Object.keys(input)) {
    if (!POLICY_KEYS.has(key)) {
      blockers.push(
        SENSITIVE_FIELD_PATTERN.test(key)
          ? `sensitive_field_present:${key}`
          : `unexpected_field:${key}`,
      );
    }
  }
  if (input.schemaVersion !== 1) blockers.push("schema_version_invalid");
  if (input.mode !== "server_initiated_only") {
    blockers.push("inbound_mode_invalid");
  }
  if (input.webhookEnabled !== false) blockers.push("webhook_not_disabled");
  if (input.webhookSecretReferencePresent !== false) {
    blockers.push("webhook_secret_reference_present");
  }
  if (input.publicWebhookRouteEnabled !== false) {
    blockers.push("public_webhook_route_enabled");
  }
  if (input.providerPayloadAccepted !== false) {
    blockers.push("provider_payload_accepted");
  }
  if (input.providerEventAuthorityAccepted !== false) {
    blockers.push("provider_event_authority_accepted");
  }
  if (input.liveAvailabilityReadRequired !== true) {
    blockers.push("live_availability_read_not_required");
  }
  if (
    input.providerInitiatedChanges !== "operator_dual_entry_manual_review"
  ) {
    blockers.push("provider_initiated_change_policy_invalid");
  }
  if (input.operationAttemptMode !== "hashed_single_attempt") {
    blockers.push("operation_attempt_mode_invalid");
  }
  if (input.mutationAutoRetryAllowed !== false) {
    blockers.push("mutation_auto_retry_allowed");
  }
  if (input.ambiguousMutationRequiresReconciliation !== true) {
    blockers.push("ambiguous_mutation_reconciliation_not_required");
  }

  const normalizedBlockers = [...new Set(blockers)].sort();
  return {
    status: normalizedBlockers.length
      ? "blocked"
      : "ready_for_separate_runtime_review",
    activationAllowed: false,
    blockers: normalizedBlockers,
  };
}
