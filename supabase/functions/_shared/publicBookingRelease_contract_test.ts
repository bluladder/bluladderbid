import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const bookingFunction = await Deno.readTextFile(
  new URL("../jobber-create-booking/index.ts", import.meta.url),
);
const bookingFlow = await Deno.readTextFile(
  new URL("../../../src/components/booking/BookingFlow.tsx", import.meta.url),
);
const recurringFunction = await Deno.readTextFile(
  new URL("../jobber-create-service-request/index.ts", import.meta.url),
);
const launchControl = await Deno.readTextFile(
  new URL(
    "../../../docs/launch/public-booking-launch-control.md",
    import.meta.url,
  ),
);
const adminDiagnostics = await Deno.readTextFile(
  new URL("../admin-diagnostics/index.ts", import.meta.url),
);
const aiTools = await Deno.readTextFile(
  new URL("./aiTools.ts", import.meta.url),
);
const operatorPanel = await Deno.readTextFile(
  new URL(
    "../../../src/components/admin/ops/CallRailDurabilityPanel.tsx",
    import.meta.url,
  ),
);

Deno.test("service mutations invalidate a previously selected slot", () => {
  const handler = bookingFlow.indexOf(
    "handlePostSlotAdditionalServiceChange",
  );
  const upsell = bookingFlow.indexOf(
    "onAdd={handlePostSlotAdditionalServiceChange}",
  );
  assert(handler >= 0);
  assert(upsell > handler);
  const body = bookingFlow.slice(handler, upsell);
  assert(body.includes("setSelectedSlot(null)"));
  assert(body.includes("Please choose a new time"));
});

Deno.test("server verifies authoritative duration before provider work", () => {
  const durationGate = bookingFunction.indexOf("SLOT_DURATION_MISMATCH");
  const firstJobberClientWrite = bookingFunction.indexOf(
    "mutation CreateClient",
  );
  assert(durationGate >= 0);
  assert(firstJobberClientWrite > durationGate);
  assert(
    bookingFunction.includes("resolveAuthoritativeDuration(engineResult)"),
  );
  assert(bookingFunction.includes("const authoritativeDuration ="));
  assert(bookingFunction.includes("scheduledIntervalMinutes"));
});

Deno.test("public launch gate allows exact read-only replay, then rejects before authoritative writes", () => {
  for (
    const [name, source] of [
      ["one-time", bookingFunction],
      ["recurring", recurringFunction],
    ] as const
  ) {
    const gate = source.indexOf("publicBookingLaunchGateResponse(");
    const parse = source.indexOf("req.json()");
    const replayLookup = source.indexOf("IDEMPOTENCY_LOOKUP_UNAVAILABLE");
    const organizationResolution = source.indexOf(
      "resolvePublicBookingOrganization(",
    );
    const interventionWrite = source.indexOf(
      "recordServiceAreaIntervention(",
    );
    const providerMutation = source.indexOf("mutation Create");

    assert(gate >= 0, `${name} launch gate is missing`);
    assert(
      parse < gate,
      `${name} cannot identify a safe replay before the gate`,
    );
    assert(
      replayLookup < gate,
      `${name} launch gate blocks completed idempotent replay`,
    );
    assert(
      organizationResolution > gate,
      `${name} organization workflow starts before the launch gate`,
    );
    assert(
      interventionWrite > gate,
      `${name} intervention write appears before the launch gate`,
    );
    assert(
      providerMutation === -1 || providerMutation > gate,
      `${name} provider mutation appears before the launch gate`,
    );
  }
});

Deno.test("protected hosted test bypass is service-authenticated and run scoped", async () => {
  const runner = await Deno.readTextFile(
    new URL("../run-booking-test/index.ts", import.meta.url),
  );
  assert(
    bookingFunction.includes("protectedBookingTestBypassAuthorized("),
  );
  assert(bookingFunction.includes("isServiceRoleToken(callerToken)"));
  assert(
    bookingFunction.includes('"X-Bluladder-Protected-Test-Run"'),
  );
  assert(
    runner.includes('"X-Bluladder-Protected-Test-Run": protectedTestRunId'),
  );
  assert(runner.includes("}, runId);"));
  assertEquals(
    recurringFunction.includes("protectedBookingTestBypassAuthorized("),
    false,
  );
});

Deno.test("public launch control documents exact protected pause and enable operations", () => {
  assert(
    launchControl.includes(
      "supabase secrets set PUBLIC_BOOKING_ENABLED=false",
    ),
  );
  assert(
    launchControl.includes(
      "supabase secrets set PUBLIC_BOOKING_ENABLED=true",
    ),
  );
  assert(launchControl.includes("not authorized"));
  assert(launchControl.includes("No control here activates Oregon"));
});

Deno.test("operators can see the fail-closed public booking status without secret values", () => {
  assert(adminDiagnostics.includes("public_booking_launch_gate"));
  assert(
    adminDiagnostics.includes(
      'Deno.env.get("PUBLIC_BOOKING_ENABLED")',
    ),
  );
  assert(operatorPanel.includes("Public booking launch control:"));
  assert(operatorPanel.includes("UNKNOWN — RELEASE BLOCKED"));
  assert(operatorPanel.includes("Diagnostic generated:"));
  assert(operatorPanel.includes("Diagnostics deployment:"));
  assert(operatorPanel.includes("setInterval(load, 60_000)"));
});

Deno.test("internal booking callers distinguish an operator pause from provider failure", () => {
  assert(aiTools.includes('json?.code === "PUBLIC_BOOKING_DISABLED"'));
  assert(aiTools.includes('"public_booking_launch_paused"'));
});

Deno.test("authoritative booking logs exclude customer and provider payloads", () => {
  for (
    const forbidden of [
      "customerEmail: booking.customer?.email",
      "Looking up customer by email:",
      "Client creation input:",
      "Property creation input:",
      "Job creation input:",
      "Visit creation input:",
      'console.log("Jobber client search result:", JSON.stringify',
      'console.log("Client properties result:", JSON.stringify',
      'console.log("Job creation result:", JSON.stringify',
      'console.log("Visit creation result:", JSON.stringify',
      'console.error("Booking creation error:", error)',
      "error.stack",
    ]
  ) {
    assertEquals(
      bookingFunction.includes(forbidden),
      false,
      `unsafe log remains: ${forbidden}`,
    );
  }
});
