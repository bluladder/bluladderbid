export type QueueDeliveryOutcome =
  | "accepted"
  | "cancelled"
  | "retry_pending"
  | "terminal_failure"
  | "uncertain";

export interface QueueMessageIdentity {
  id: string;
  outbound_idempotency_key?: string | null;
}

export function queuedProviderIdempotencyKey(
  message: QueueMessageIdentity,
): string {
  const durable = message.outbound_idempotency_key?.trim();
  return durable || `queue:${message.id}`;
}

export function queueOutcomePatch(
  outcome: QueueDeliveryOutcome,
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  if (outcome === "accepted") {
    return {
      ...patch,
      status: "accepted",
      outbox_state: "provider_accepted",
      next_retry_at: null,
      error: null,
    };
  }
  if (outcome === "uncertain") {
    return {
      ...patch,
      status: "processing",
      outbox_state: "delivery_unknown",
      next_retry_at: null,
    };
  }
  if (outcome === "retry_pending") {
    return {
      ...patch,
      status: "pending",
      outbox_state: null,
      send_claim_token: null,
      send_claim_at: null,
    };
  }
  return {
    ...patch,
    status: outcome === "cancelled" ? "cancelled" : "failed",
    outbox_state: "send_failed",
    next_retry_at: null,
  };
}

export function smsFailureOutcome(input: {
  providerResponseKind?: string | null;
  providerStatus?: number | null;
  attempts: number;
  maxAttempts: number;
}): QueueDeliveryOutcome {
  if (input.providerResponseKind === "transport_uncertain") return "uncertain";
  if (
    input.providerStatus === 408 ||
    (input.providerStatus != null && input.providerStatus >= 500)
  ) {
    return "uncertain";
  }
  if (
    input.providerStatus != null &&
    input.providerStatus >= 400 &&
    input.providerStatus !== 429
  ) {
    return "terminal_failure";
  }
  return input.attempts >= input.maxAttempts
    ? "terminal_failure"
    : "retry_pending";
}

export function emailFailureOutcome(input: {
  category?: string | null;
  httpStatus?: number | null;
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
}): QueueDeliveryOutcome {
  if (input.category === "network_error") return "uncertain";
  if (
    input.httpStatus === 408 ||
    (input.httpStatus != null && input.httpStatus >= 500)
  ) {
    return "uncertain";
  }
  if (!input.retryable || input.attempts >= input.maxAttempts) {
    return "terminal_failure";
  }
  return "retry_pending";
}
