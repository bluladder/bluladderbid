import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  emailFailureOutcome,
  queuedProviderIdempotencyKey,
  queueOutcomePatch,
  smsFailureOutcome,
} from "./queueDelivery.ts";

Deno.test("queue provider key is stable across retries", () => {
  assertEquals(
    queuedProviderIdempotencyKey({ id: "message-1" }),
    "queue:message-1",
  );
  assertEquals(
    queuedProviderIdempotencyKey({
      id: "message-1",
      outbound_idempotency_key: "campaign:event:step",
    }),
    "campaign:event:step",
  );
});

Deno.test("transport uncertainty is never retried", () => {
  assertEquals(
    smsFailureOutcome({
      providerResponseKind: "transport_uncertain",
      attempts: 1,
      maxAttempts: 3,
    }),
    "uncertain",
  );
  assertEquals(
    emailFailureOutcome({
      category: "network_error",
      retryable: true,
      attempts: 1,
      maxAttempts: 3,
    }),
    "uncertain",
  );
});

Deno.test("known provider rejection may retry within the bound", () => {
  assertEquals(
    smsFailureOutcome({
      providerResponseKind: "http_rejection",
      providerStatus: 429,
      attempts: 1,
      maxAttempts: 3,
    }),
    "retry_pending",
  );
  assertEquals(
    emailFailureOutcome({
      category: "rate_limited",
      httpStatus: 429,
      retryable: true,
      attempts: 3,
      maxAttempts: 3,
    }),
    "terminal_failure",
  );
});

Deno.test("timeouts and server errors are uncertain, not retryable", () => {
  assertEquals(
    smsFailureOutcome({
      providerResponseKind: "http_rejection",
      providerStatus: 503,
      attempts: 1,
      maxAttempts: 3,
    }),
    "uncertain",
  );
  assertEquals(
    emailFailureOutcome({
      category: "provider_rejected",
      httpStatus: 500,
      retryable: true,
      attempts: 1,
      maxAttempts: 3,
    }),
    "uncertain",
  );
});

Deno.test("uncertain outcome remains processing and observable", () => {
  assertEquals(
    queueOutcomePatch("uncertain", { error: "provider_result_unknown" }),
    {
      error: "provider_result_unknown",
      status: "processing",
      outbox_state: "delivery_unknown",
      next_retry_at: null,
    },
  );
});

Deno.test("retry releases the claim and accepted is terminal", () => {
  assertEquals(queueOutcomePatch("retry_pending", { attempts: 1 }), {
    attempts: 1,
    status: "pending",
    outbox_state: null,
    send_claim_token: null,
    send_claim_at: null,
  });
  assertEquals(queueOutcomePatch("accepted", { provider_message_id: "p-1" }), {
    provider_message_id: "p-1",
    status: "accepted",
    outbox_state: "provider_accepted",
    next_retry_at: null,
    error: null,
  });
});
