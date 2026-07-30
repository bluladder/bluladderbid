export type PublicBookingLaunchGateReason =
  | "enabled"
  | "operator_paused"
  | "not_configured"
  | "invalid_configuration";

export interface PublicBookingLaunchGateDecision {
  enabled: boolean;
  reason: PublicBookingLaunchGateReason;
}

export function evaluatePublicBookingLaunchGate(
  configuredValue: string | undefined,
): PublicBookingLaunchGateDecision {
  if (configuredValue === undefined || configuredValue.length === 0) {
    return { enabled: false, reason: "not_configured" };
  }
  if (configuredValue === "true") {
    return { enabled: true, reason: "enabled" };
  }
  if (configuredValue === "false") {
    return { enabled: false, reason: "operator_paused" };
  }
  return { enabled: false, reason: "invalid_configuration" };
}

export function publicBookingLaunchGateResponse(
  workflow: "one_time_booking" | "recurring_service_request",
  configuredValue: string | undefined,
  headers: Record<string, string>,
): Response | null {
  const decision = evaluatePublicBookingLaunchGate(configuredValue);
  if (decision.enabled) return null;

  const correlationId = crypto.randomUUID();
  console.warn(JSON.stringify({
    event: "public_booking_launch_gate_rejected",
    workflow,
    reason_code: decision.reason,
    correlation_id: correlationId,
    authoritative_write_attempted: false,
  }));

  return new Response(
    JSON.stringify({
      success: false,
      status: "launch_disabled",
      code: "PUBLIC_BOOKING_DISABLED",
      retryable: false,
      correlationId,
      error:
        "Online booking is temporarily unavailable, so this attempt was not processed. If you submitted earlier, check your confirmation before trying again. You may also contact BluLadder directly.",
    }),
    {
      status: 503,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
    },
  );
}
