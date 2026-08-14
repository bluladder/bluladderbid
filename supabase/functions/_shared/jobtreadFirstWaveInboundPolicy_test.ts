// deno-lint-ignore-file no-import-prefix
import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluateJobTreadFirstWaveInboundPolicy,
  JOBTREAD_FIRST_WAVE_SERVER_INITIATED_POLICY,
} from "./jobtreadFirstWaveInboundPolicy.ts";

function candidate(): Record<string, unknown> {
  return {
    ...structuredClone(JOBTREAD_FIRST_WAVE_SERVER_INITIATED_POLICY),
  };
}

Deno.test("exact server-initiated policy reaches only runtime review", () => {
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(candidate()),
    {
      status: "ready_for_separate_runtime_review",
      activationAllowed: false,
      blockers: [],
    },
  );
});

Deno.test("enabled webhook and public route fail closed", () => {
  const input = candidate();
  input.webhookEnabled = true;
  input.publicWebhookRouteEnabled = true;
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    ["public_webhook_route_enabled", "webhook_not_disabled"],
  );
});

Deno.test("webhook secret reference is prohibited in no-webhook mode", () => {
  const input = candidate();
  input.webhookSecretReferencePresent = true;
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    ["webhook_secret_reference_present"],
  );
});

Deno.test("provider payload and event authority are never accepted", () => {
  const input = candidate();
  input.providerPayloadAccepted = true;
  input.providerEventAuthorityAccepted = true;
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    ["provider_event_authority_accepted", "provider_payload_accepted"],
  );
});

Deno.test("live availability and operator dual entry remain mandatory", () => {
  const input = candidate();
  input.liveAvailabilityReadRequired = false;
  input.providerInitiatedChanges = "automatic";
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    [
      "live_availability_read_not_required",
      "provider_initiated_change_policy_invalid",
    ],
  );
});

Deno.test("mutation retry and uncertain-outcome weakening fail closed", () => {
  const input = candidate();
  input.operationAttemptMode = "untracked";
  input.mutationAutoRetryAllowed = true;
  input.ambiguousMutationRequiresReconciliation = false;
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    [
      "ambiguous_mutation_reconciliation_not_required",
      "mutation_auto_retry_allowed",
      "operation_attempt_mode_invalid",
    ],
  );
});

Deno.test("secret/provider fields and unrelated extras are rejected", () => {
  const input = candidate();
  input.grantKey = "not accepted";
  input.providerId = "not accepted";
  input.retryCount = 1;
  assertEquals(
    evaluateJobTreadFirstWaveInboundPolicy(input).blockers,
    [
      "sensitive_field_present:grantKey",
      "sensitive_field_present:providerId",
      "unexpected_field:retryCount",
    ],
  );
});

Deno.test("malformed input cannot activate anything", () => {
  for (const value of [null, [], "server_initiated_only"]) {
    const result = evaluateJobTreadFirstWaveInboundPolicy(value);
    assertEquals(result.status, "blocked");
    assertFalse(result.activationAllowed);
  }
});
