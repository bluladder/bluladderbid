import {
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  evaluatePublicBookingLaunchGate,
  publicBookingLaunchGateResponse,
} from "./publicBookingLaunchGate.ts";

Deno.test("public booking launch gate enables only the exact reviewed value", () => {
  assertEquals(evaluatePublicBookingLaunchGate("true"), {
    enabled: true,
    reason: "enabled",
  });
  assertEquals(evaluatePublicBookingLaunchGate("false"), {
    enabled: false,
    reason: "operator_paused",
  });
  for (const value of [undefined, ""]) {
    assertEquals(evaluatePublicBookingLaunchGate(value), {
      enabled: false,
      reason: "not_configured",
    });
  }
  for (const value of ["TRUE", " true", "true ", "1", "yes"]) {
    assertEquals(evaluatePublicBookingLaunchGate(value), {
      enabled: false,
      reason: "invalid_configuration",
    });
  }
});

Deno.test("disabled public booking response is truthful, non-retryable, and correlated", async () => {
  const response = publicBookingLaunchGateResponse(
    "one_time_booking",
    "false",
    { "Access-Control-Allow-Origin": "*" },
  );
  if (!response) throw new Error("expected a disabled response");

  assertEquals(response.status, 503);
  assertMatch(
    response.headers.get("X-Correlation-Id") ?? "",
    /^[0-9a-f-]{36}$/,
  );
  const body = await response.json();
  assertEquals(body.code, "PUBLIC_BOOKING_DISABLED");
  assertEquals(body.status, "launch_disabled");
  assertEquals(body.retryable, false);
  assertMatch(body.error, /this attempt was not processed/);
});

Deno.test("enabled public booking launch gate returns control to the workflow", () => {
  assertEquals(
    publicBookingLaunchGateResponse(
      "recurring_service_request",
      "true",
      {},
    ),
    null,
  );
});
