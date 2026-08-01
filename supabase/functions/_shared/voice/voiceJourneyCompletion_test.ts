import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addressComponentAttemptsExhausted,
  addressComponentQuestion,
  addressComponentsFromServiceAreaResult,
  formatAddressComponents,
  nextMissingAddressComponent,
  normalizeAddressComponentAnswer,
  recordAddressComponentAttempt,
} from "./voiceAddressGate.ts";
import {
  canAttemptAppointmentMutation,
  resolveVoiceAppointmentOutcome,
  voiceAppointmentIdempotencyKey,
} from "./voiceAppointmentRecovery.ts";
import {
  applyCanonicalVoiceAnswer,
  buildCanonicalPrePriceRecap,
} from "./voiceCanonicalIntake.ts";
import {
  describeVoiceDelivery,
  normalizeDeliveryStatus,
} from "./voiceDeliveryState.ts";
import {
  buildFieldTeamMemo,
  planDestructiveAppointmentAction,
  selectLatestQuoteForContinuation,
} from "./voiceExistingRecords.ts";
import {
  classifyExplicitConfirmation,
  classifyVoiceJourneyIntent,
  PRICE_ASSURANCE,
  quoteIdentityMatches,
  VOICE_OPENING,
} from "./voiceJourneyContract.ts";
import type { QuoteSession } from "../quoteSession.ts";

const empty = (): QuoteSession => ({
  id: "s1",
  channel: "voice",
  conversationIds: ["c1"],
  fields: {},
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "none",
  bookingReady: false,
});

Deno.test("authoritative opening and price assurance are exact", () => {
  assertEquals(
    VOICE_OPENING,
    "Hi, thank you for calling BluLadder. Are you calling to get a quote, schedule an appointment, or do you have a specific question?",
  );
  assertEquals(
    PRICE_ASSURANCE,
    "As long as the information you provided is accurate, we’ll stand by this price. If anything is different when we arrive, we’ll discuss it with you before any additional work begins.",
  );
});

Deno.test("voice journey intent separates quote, existing records and destructive actions", () => {
  assertEquals(classifyVoiceJourneyIntent("I need a new quote"), "new_quote");
  assertEquals(
    classifyVoiceJourneyIntent("Can you pull up my old estimate?"),
    "existing_quote",
  );
  assertEquals(classifyVoiceJourneyIntent("Move my appointment"), "reschedule");
  assertEquals(classifyVoiceJourneyIntent("Cancel my visit"), "cancel");
  assertEquals(
    classifyVoiceJourneyIntent("Tell the crew the gate code changed"),
    "question_or_memo",
  );
});

Deno.test("destructive confirmation rejects conversational acknowledgements", () => {
  assertEquals(classifyExplicitConfirmation("sounds good"), "unclear");
  assertEquals(classifyExplicitConfirmation("okay"), "unclear");
  assertEquals(classifyExplicitConfirmation("yes, cancel it"), "unclear");
  assertEquals(classifyExplicitConfirmation("cancel it"), "confirmed");
  assertEquals(classifyExplicitConfirmation("no, don't"), "declined");
});

Deno.test("whole-home is defaulted only after explicit window-service intent; sides remain unanswered", () => {
  const result = applyCanonicalVoiceAnswer(
    empty(),
    "services",
    "I need all my home windows cleaned",
  );
  assert(result.accepted);
  assertEquals(result.session.fields.windowCleaningScope, "whole_home");
  assertEquals(result.session.fieldStatus.windowCleaningScope, "defaulted");
  assertEquals(result.session.fields.windowCleaningSides, undefined);
});

Deno.test("partial-window behavior requires explicit partial language", () => {
  const result = applyCanonicalVoiceAnswer(
    empty(),
    "services",
    "I only need five specific windows cleaned",
  );
  assert(result.accepted);
  assertEquals(result.session.fields.windowCleaningScope, "partial");
});

Deno.test("canonical sides question never turns a missing answer into exterior only", () => {
  const unclear = applyCanonicalVoiceAnswer(
    empty(),
    "windowCleaningSides",
    "whatever is normal",
  );
  assertEquals(unclear.accepted, false);
  const exterior = applyCanonicalVoiceAnswer(
    empty(),
    "windowCleaningSides",
    "outside only",
  );
  assertEquals(exterior.session.fields.windowCleaningSides, "outside_only");
});

Deno.test("canonical pre-price recap confirms assumptions without defaulting sides", () => {
  let session = applyCanonicalVoiceAnswer(
    empty(),
    "services",
    "whole-home window cleaning",
  ).session;
  session = applyCanonicalVoiceAnswer(
    session,
    "windowCleaningSides",
    "inside and outside",
  ).session;
  session = applyCanonicalVoiceAnswer(session, "squareFootage", "2400").session;
  const recap = buildCanonicalPrePriceRecap(session.fields);
  assertStringIncludes(recap, "whole-home window cleaning");
  assertStringIncludes(recap, "inside and outside");
  assertStringIncludes(recap, "2,400".replace(",", ""));
  const confirmed = applyCanonicalVoiceAnswer(
    session,
    "priceChangingAssumptionConfirmation",
    "yes",
  );
  assert(confirmed.accepted);
  assertEquals(confirmed.session.fields.confirmationSummary?.confirmed, true);
  assert(
    confirmed.session.fields.confirmationSummary?.confirmedFieldIds.includes(
      "windowCleaningSides",
    ),
  );
});

Deno.test("delivery language distinguishes provider acceptance, queued, retry and uncertainty", () => {
  assertEquals(
    describeVoiceDelivery({ channel: "sms", status: "provider_accepted" })
      .completed,
    true,
  );
  assertStringIncludes(
    describeVoiceDelivery({ channel: "sms", status: "queued" }).spoken,
    "queued",
  );
  assertStringIncludes(
    describeVoiceDelivery({ channel: "email", status: "retry_pending" }).spoken,
    "retry",
  );
  assertStringIncludes(
    describeVoiceDelivery({ channel: "sms", status: "uncertain" }).spoken,
    "can't confirm",
  );
  assertEquals(normalizeDeliveryStatus("delivery_unknown"), "uncertain");
  assertEquals(normalizeDeliveryStatus("failed_terminal"), "failed_terminal");
  assertStringIncludes(
    describeVoiceDelivery({ channel: "email", status: "delivered" }).spoken,
    "delivered",
  );
  assertEquals(
    describeVoiceDelivery({ channel: "sms", status: "pending" }).completed,
    false,
  );
});

Deno.test("component-specific recovery is bounded before human follow-up", () => {
  const candidate = {
    status: "component_incomplete" as const,
    components: { street: "Binbranch Lane", city: "McKinney" },
    pendingComponent: "house_number" as const,
  };
  const once = recordAddressComponentAttempt(candidate, "house_number");
  assertEquals(addressComponentAttemptsExhausted(once, "house_number"), false);
  const twice = recordAddressComponentAttempt(once, "house_number");
  assertEquals(addressComponentAttemptsExhausted(twice, "house_number"), true);
});

Deno.test("component-specific address recovery retains verified components", () => {
  const components = addressComponentsFromServiceAreaResult({
    streetNumber: "5612",
    route: "Binbranch Lane",
    state: "TX",
  });
  assertEquals(nextMissingAddressComponent(components), "city");
  assertStringIncludes(addressComponentQuestion("city"), "city");
  const city = normalizeAddressComponentAnswer("city", "McKinney");
  const zip = normalizeAddressComponentAnswer(
    "postal_code",
    "seven five zero seven one",
  );
  assertEquals(city, "McKinney");
  assertEquals(zip, "75071");
  assertEquals(
    formatAddressComponents({ ...components, city: city!, postal_code: zip! }),
    "5612 Binbranch Lane, McKinney TX 75071",
  );
});

Deno.test("component-specific address recovery covers street, unit, state and invalid answers", () => {
  assertStringIncludes(addressComponentQuestion("street"), "street name");
  assertStringIncludes(addressComponentQuestion("unit"), "unit number");
  assertStringIncludes(addressComponentQuestion("state"), "state");
  assertEquals(
    normalizeAddressComponentAnswer("street", "Binbranch Lane"),
    "Binbranch Lane",
  );
  assertEquals(
    normalizeAddressComponentAnswer("unit", "Suite 200"),
    "Suite 200",
  );
  assertEquals(normalizeAddressComponentAnswer("state", "Texas"), "TX");
  assertEquals(
    normalizeAddressComponentAnswer("postal_code", "not sure"),
    null,
  );
  assertEquals(
    normalizeAddressComponentAnswer("street", "owner@example.com"),
    null,
  );
  assertEquals(
    formatAddressComponents({
      house_number: "5612",
      street: "Binbranch Lane",
      unit: "Suite 200",
      city: "McKinney",
      state: "TX",
      postal_code: "75071",
    }),
    "5612 Binbranch Lane, Suite 200, McKinney TX 75071",
  );
});

Deno.test("quote identity comparison rejects stale version or input key", () => {
  const expected = {
    quoteSessionId: "session-1",
    quoteId: "quote-1",
    inputsKey: "inputs-v2",
    pricingVersion: 7,
    engineVersion: "engine-v3",
    durationVersion: "duration-v1",
    taxPolicyVersion: "tax-v1",
  };
  assert(quoteIdentityMatches(expected, expected));
  assertEquals(
    quoteIdentityMatches(expected, { ...expected, inputsKey: "inputs-v1" }),
    false,
  );
  assertEquals(
    quoteIdentityMatches(expected, { ...expected, durationVersion: "old" }),
    false,
  );
});

Deno.test("existing quote continuation never silently revives expired or superseded price", () => {
  assertEquals(selectLatestQuoteForContinuation([]).status, "not_found");
  assertEquals(
    selectLatestQuoteForContinuation([{
      id: "q1",
      status: "superseded",
      total: 100,
      updatedAt: null,
      expiresAt: null,
      supersededAt: "2026-08-01T00:00:00Z",
      sourceSessionId: "s1",
    }]).status,
    "expired_or_superseded",
  );
});

Deno.test("appointment mutation requires exact booking and explicit final confirmation", () => {
  const booking = {
    id: "b1",
    referenceNumber: "BL-100",
    status: "confirmed",
    scheduledStart: "2026-08-04T15:00:00Z",
    scheduledEnd: "2026-08-04T17:00:00Z",
    durationMinutes: 120,
    quoteId: "q1",
    bookingVersion: 1,
  };
  assertEquals(
    planDestructiveAppointmentAction([booking], {}).status,
    "confirmation_required",
  );
  assertEquals(
    planDestructiveAppointmentAction([booking], { confirmation: "cancel it" })
      .status,
    "authorized",
  );
  assertEquals(
    planDestructiveAppointmentAction([booking, { ...booking, id: "b2" }], {})
      .status,
    "ambiguous_booking",
  );
});

Deno.test("appointment outcome never claims success without provider and local truth", () => {
  const confirmed = resolveVoiceAppointmentOutcome(
    "book",
    { status: "accepted", providerOperationId: "provider-1" },
    { status: "persisted", localRecordId: "booking-1" },
  );
  assertEquals(confirmed.status, "confirmed");
  assertEquals(confirmed.customerMayHearSuccess, true);

  const localFailure = resolveVoiceAppointmentOutcome(
    "reschedule",
    { status: "accepted", providerOperationId: "provider-2" },
    { status: "failed", reasonCode: "db_timeout" },
  );
  assertEquals(localFailure.status, "provider_accepted_local_unconfirmed");
  assertEquals(localFailure.automaticRetryAllowed, false);
  assertEquals(localFailure.reconciliationRequired, true);

  const uncertain = resolveVoiceAppointmentOutcome(
    "cancel",
    { status: "timeout" },
    { status: "not_attempted" },
  );
  assertEquals(uncertain.status, "provider_outcome_uncertain");
  assertEquals(uncertain.customerMayHearSuccess, false);
});

Deno.test("booking gate requires exact identity, quote, duration, area, slot and confirmation", () => {
  const ready = canAttemptAppointmentMutation({
    action: "book",
    identityResolved: true,
    organizationResolved: true,
    exactRecordSelected: true,
    explicitFinalConfirmation: true,
    quoteIdentityCurrent: true,
    durationAvailable: true,
    serviceAreaEligible: true,
    slotRevalidation: { status: "current" },
  });
  assertEquals(ready.allowed, true);
  const stale = canAttemptAppointmentMutation({
    action: "book",
    identityResolved: true,
    organizationResolved: true,
    exactRecordSelected: true,
    explicitFinalConfirmation: true,
    quoteIdentityCurrent: false,
    durationAvailable: true,
    serviceAreaEligible: true,
    slotRevalidation: { status: "current" },
  });
  assertEquals(stale, {
    allowed: false,
    reason: "stale_quote",
    spoken:
      "The quote is no longer current, so I need to verify the latest price before booking.",
  });
});

Deno.test("appointment idempotency binds tenant, customer, version and target", () => {
  const first = voiceAppointmentIdempotencyKey({
    action: "reschedule",
    organizationId: "org-1",
    customerId: "customer-1",
    bookingId: "booking-1",
    bookingVersion: 2,
    targetStart: "2026-08-04T15:00:00Z",
  });
  assertEquals(
    first,
    voiceAppointmentIdempotencyKey({
      action: "reschedule",
      organizationId: "org-1",
      customerId: "customer-1",
      bookingId: "booking-1",
      bookingVersion: 2,
      targetStart: "2026-08-04T15:00:00Z",
    }),
  );
  assert(
    first !== voiceAppointmentIdempotencyKey({
      action: "reschedule",
      organizationId: "org-1",
      customerId: "customer-1",
      bookingId: "booking-1",
      bookingVersion: 3,
      targetStart: "2026-08-04T15:00:00Z",
    }),
  );
});

Deno.test("field-team memo is bounded and cannot alter quote state", () => {
  const memo = buildFieldTeamMemo({
    bookingId: "b1",
    customerId: "c1",
    text: "Please use the side gate.   The latch sticks.",
  });
  assertEquals(memo, {
    bookingId: "b1",
    customerId: "c1",
    text: "Please use the side gate. The latch sticks.",
    source: "voice",
  });
});
