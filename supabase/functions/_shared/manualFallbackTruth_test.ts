import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

async function text(path: string): Promise<string> {
  return await Deno.readTextFile(new URL(path, import.meta.url));
}

Deno.test("booking and recurring customer fallbacks never claim unproven notification", async () => {
  const booking = await text("../jobber-create-booking/index.ts");
  const bookingUi = await text(
    "../../../src/components/booking/BookingFlow.tsx",
  );
  const contactUi = await text(
    "../../../src/components/booking/BookingHelpContact.tsx",
  );
  const recurringUi = await text(
    "../../../src/components/booking/RecurringServiceRequestFlow.tsx",
  );

  assertEquals(booking.includes("team has been notified"), false);
  assertStringIncludes(booking, '"intervention_recorded"');
  assertStringIncludes(booking, '"intervention_record_failed"');
  assertStringIncludes(booking, "recordServiceAreaIntervention(");
  assertStringIncludes(booking, '"SERVICE_AREA_INTERVENTION_FAILED"');
  assertStringIncludes(
    bookingUi,
    "Please do not resubmit this time slot",
  );
  assertStringIncludes(
    contactUi,
    "Your request was recorded for BluLadder to review.",
  );
  assertEquals(contactUi.includes("BluLadder has been notified"), false);
  assertStringIncludes(
    recurringUi,
    "No follow-up request was recorded",
  );
  assertStringIncludes(
    recurringUi,
    "service_area_manual_review",
  );
});

Deno.test("AI and SMS failure copy distinguishes failed, uncertain, and recorded states", async () => {
  const aiTools = await text("./aiTools.ts");
  const smsConfirmation = await text("./handleConfirmationReply.ts");
  const smsOrchestrator = await text("./smsOrchestrator.ts");

  assertStringIncludes(
    aiTools,
    "No appointment or follow-up request was created",
  );
  assertStringIncludes(
    aiTools,
    "I couldn't record a manual-review request",
  );
  assertStringIncludes(
    aiTools,
    "Please do not try the booking again",
  );
  assertEquals(
    aiTools.includes("the team will follow up to confirm"),
    false,
  );
  assertStringIncludes(
    smsConfirmation,
    "The scheduling result is uncertain",
  );
  assertStringIncludes(
    smsConfirmation,
    "no appointment is confirmed",
  );
  assertStringIncludes(
    smsOrchestrator,
    "We couldn't record your request right now",
  );
});
