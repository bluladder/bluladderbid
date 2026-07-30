import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const customerActions = await Deno.readTextFile(
  new URL("../customer-appointment-actions/index.ts", import.meta.url),
);
const runner = await Deno.readTextFile(
  new URL("../run-booking-test/index.ts", import.meta.url),
);

Deno.test("protected cleanup header is admin-authenticated, run-scoped, and booking-bound", () => {
  const validationStart = customerActions.indexOf(
    "const protectedTestRunId = req.headers.get(",
  );
  const communicationStart = customerActions.indexOf(
    "const cancelFreshlyConfirmed",
  );
  assert(validationStart >= 0 && communicationStart > validationStart);
  const validation = customerActions.slice(
    validationStart,
    communicationStart,
  );

  assertStringIncludes(validation, "protectedTestRunId && isVerifiedAdmin");
  assertStringIncludes(validation, 'action === "cancel"');
  assertStringIncludes(validation, '.from("booking_test_runs")');
  assertStringIncludes(validation, "protectedRun?.booking_id === bookingId");
  assertStringIncludes(validation, 'protectedRun?.phase === "cancel_cleanup"');
  assertStringIncludes(validation, 'protectedRun?.status === "running"');
});

Deno.test("protected execution and cleanup synchronously suppress communication and campaign paths", () => {
  assertStringIncludes(
    customerActions,
    "smsEvent && campaignEvent && !protectedSyntheticCleanup",
  );
  assertStringIncludes(
    customerActions,
    'event: "protected_booking_test_cleanup_communications_suppressed"',
  );
  assertStringIncludes(customerActions, "communicationsSuppressed: true");
  assertStringIncludes(
    runner,
    '"X-Bluladder-Protected-Test-Run": protectedTestRunId',
  );
  assertStringIncludes(
    runner,
    "cancelResp.json?.protectedTest?.communicationsSuppressed !== true",
  );
  assertStringIncludes(
    runner,
    "bookResp.json?.protectedTest?.communicationsSuppressed !== true",
  );
});
