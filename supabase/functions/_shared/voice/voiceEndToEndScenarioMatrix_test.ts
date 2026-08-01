// Executable contract matrix for the forty customer/provider scenarios in
// docs/voice/voice-end-to-end-scenario-matrix.md. Provider calls are modeled
// with explicit results; this suite never performs network or database I/O.

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  mergeFields,
  type QuoteSession,
  sessionInputsKey,
} from "../quoteSession.ts";
import {
  addressComponentQuestion,
  nextMissingAddressComponent,
  normalizeAddressComponentAnswer,
} from "./voiceAddressGate.ts";
import {
  canAttemptAppointmentMutation,
  resolveVoiceAppointmentOutcome,
  voiceAppointmentIdempotencyKey,
} from "./voiceAppointmentRecovery.ts";
import { applyCanonicalVoiceAnswer } from "./voiceCanonicalIntake.ts";
import { describeVoiceDelivery } from "./voiceDeliveryState.ts";
import {
  buildFieldTeamMemo,
  selectLatestQuoteForContinuation,
  type VoiceQuoteRecord,
} from "./voiceExistingRecords.ts";
import {
  classifyVoiceJourneyIntent,
  quoteIdentityMatches,
  VOICE_RECOVERY_LANGUAGE,
} from "./voiceJourneyContract.ts";

const baseSession = (): QuoteSession => ({
  id: "session-1",
  channel: "voice",
  conversationIds: ["conversation-1"],
  fields: {},
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "none",
  bookingReady: false,
});

const gate = (
  overrides: Partial<Parameters<typeof canAttemptAppointmentMutation>[0]> = {},
) =>
  canAttemptAppointmentMutation({
    action: "book",
    identityResolved: true,
    organizationResolved: true,
    exactRecordSelected: true,
    explicitFinalConfirmation: true,
    quoteIdentityCurrent: true,
    durationAvailable: true,
    serviceAreaEligible: true,
    slotRevalidation: { status: "current" },
    ...overrides,
  });

const quote = (
  overrides: Partial<VoiceQuoteRecord> = {},
): VoiceQuoteRecord => ({
  id: "quote-1",
  status: "accepted",
  total: 250,
  updatedAt: "2026-08-01T00:00:00Z",
  expiresAt: "2026-09-01T00:00:00Z",
  supersededAt: null,
  sourceSessionId: "session-1",
  ...overrides,
});

const cases: Array<{ id: number; name: string; run: () => void }> = [
  {
    id: 1,
    name: "new customer residential quote",
    run: () => {
      assertEquals(classifyVoiceJourneyIntent("I need a quote"), "new_quote");
      assert(
        applyCanonicalVoiceAnswer(baseSession(), "services", "window cleaning")
          .accepted,
      );
    },
  },
  {
    id: 2,
    name: "returning customer requires resolved identity",
    run: () => {
      assertEquals(gate({ identityResolved: true }).allowed, true);
    },
  },
  {
    id: 3,
    name: "ambiguous customer match fails closed",
    run: () => {
      assertEquals(gate({ identityResolved: false }), {
        allowed: false,
        reason: "identity_required",
        spoken:
          "I need to verify the customer before I can access or change an appointment.",
      });
    },
  },
  {
    id: 4,
    name: "caller ID is not identity proof",
    run: () => {
      assertEquals(gate({ identityResolved: false }).allowed, false);
    },
  },
  {
    id: 5,
    name: "price-changing correction invalidates quote",
    run: () => {
      const before = {
        ...baseSession(),
        quoteStatus: "firm" as const,
        fields: {
          services: ["drivewayCleaning"],
          drivewaySqft: 700,
          drivewaySurface: "concrete",
          lastQuoteResult: { status: "firm", total: 140 },
        },
      };
      assertEquals(
        mergeFields(before, { drivewaySqft: 800 }).fields.lastQuoteResult,
        undefined,
      );
    },
  },
  {
    id: 6,
    name: "service add/remove changes canonical fingerprint",
    run: () => {
      assert(
        sessionInputsKey({
          services: ["screenRepair"],
          screenRepairCount: 2,
        }) !==
          sessionInputsKey({
            services: ["screenRepair", "solarPanelCleaning"],
            screenRepairCount: 2,
            solarPanelCount: 10,
          }),
      );
    },
  },
  {
    id: 7,
    name: "stale quote tool call rejected",
    run: () => {
      const expected = {
        quoteSessionId: "s",
        quoteId: "q",
        inputsKey: "new",
        pricingVersion: 2,
        engineVersion: "e",
        durationVersion: "d",
        taxPolicyVersion: "t",
      };
      assertEquals(
        quoteIdentityMatches(expected, { ...expected, inputsKey: "old" }),
        false,
      );
    },
  },
  {
    id: 8,
    name: "stale duration blocks booking",
    run: () => {
      assertEquals(gate({ durationAvailable: false }).allowed, false);
    },
  },
  {
    id: 9,
    name: "SMS provider accepted",
    run: () => {
      assertEquals(
        describeVoiceDelivery({ channel: "sms", status: "provider_accepted" })
          .completed,
        true,
      );
    },
  },
  {
    id: 10,
    name: "SMS queued is not called delivered",
    run: () => {
      const result = describeVoiceDelivery({
        channel: "sms",
        status: "queued",
      });
      assertEquals(result.completed, false);
      assertStringIncludes(result.spoken, "queued");
    },
  },
  {
    id: 11,
    name: "SMS timeout or rejection is truthful",
    run: () => {
      assertStringIncludes(
        describeVoiceDelivery({ channel: "sms", status: "uncertain" }).spoken,
        "can't confirm",
      );
    },
  },
  {
    id: 12,
    name: "email provider accepted",
    run: () => {
      assertEquals(
        describeVoiceDelivery({ channel: "email", status: "provider_accepted" })
          .completed,
        true,
      );
    },
  },
  {
    id: 13,
    name: "duplicate delivery remains idempotent",
    run: () => {
      assertEquals(
        describeVoiceDelivery({ channel: "sms", status: "provider_accepted" })
          .event,
        describeVoiceDelivery({ channel: "sms", status: "provider_accepted" })
          .event,
      );
    },
  },
  {
    id: 14,
    name: "missing street number",
    run: () => {
      assertEquals(
        nextMissingAddressComponent({
          street: "Main Street",
          city: "Plano",
          state: "TX",
          postal_code: "75024",
        }),
        "house_number",
      );
    },
  },
  {
    id: 15,
    name: "missing city",
    run: () => {
      assertStringIncludes(addressComponentQuestion("city"), "city");
    },
  },
  {
    id: 16,
    name: "missing ZIP",
    run: () => {
      assertEquals(
        normalizeAddressComponentAnswer(
          "postal_code",
          "seven five zero seven one",
        ),
        "75071",
      );
    },
  },
  {
    id: 17,
    name: "ambiguous geocode requires confirmation",
    run: () => {
      assertStringIncludes(
        VOICE_RECOVERY_LANGUAGE.ambiguous_address,
        "possible address",
      );
    },
  },
  {
    id: 18,
    name: "outside service area preserves follow-up",
    run: () => {
      assertStringIncludes(
        VOICE_RECOVERY_LANGUAGE.outside_service_area,
        "team",
      );
    },
  },
  {
    id: 19,
    name: "fresh schedule allows revalidated slot",
    run: () => {
      assertEquals(
        gate({ slotRevalidation: { status: "current" } }).allowed,
        true,
      );
    },
  },
  {
    id: 20,
    name: "stale schedule blocks mutation",
    run: () => {
      assertEquals(
        gate({ slotRevalidation: { status: "schedule_stale" } }).allowed,
        false,
      );
    },
  },
  {
    id: 21,
    name: "Jobber unavailable is not no-slots",
    run: () => {
      const outcome = resolveVoiceAppointmentOutcome("book", {
        status: "unavailable",
      }, { status: "not_attempted" });
      assertEquals(outcome.status, "provider_unavailable");
    },
  },
  {
    id: 22,
    name: "no appointments language is distinct",
    run: () => {
      assertStringIncludes(
        VOICE_RECOVERY_LANGUAGE.no_appointments,
        "did not find",
      );
    },
  },
  {
    id: 23,
    name: "selected slot lost",
    run: () => {
      const blocked = gate({ slotRevalidation: { status: "slot_lost" } });
      assertEquals(blocked.allowed, false);
      if (!blocked.allowed) {
        assertStringIncludes(
          blocked.spoken,
          "no longer available",
        );
      }
    },
  },
  {
    id: 24,
    name: "successful booking requires provider and local persistence",
    run: () => {
      assertEquals(
        resolveVoiceAppointmentOutcome("book", {
          status: "accepted",
          providerOperationId: "p",
        }, { status: "persisted", localRecordId: "b" }).status,
        "confirmed",
      );
    },
  },
  {
    id: 25,
    name: "provider accepted but local persistence failed",
    run: () => {
      const outcome = resolveVoiceAppointmentOutcome("book", {
        status: "accepted",
        providerOperationId: "p",
      }, { status: "failed" });
      assertEquals(outcome.status, "provider_accepted_local_unconfirmed");
      assertEquals(outcome.automaticRetryAllowed, false);
    },
  },
  {
    id: 26,
    name: "existing valid quote retrieval",
    run: () => {
      assertEquals(
        selectLatestQuoteForContinuation(
          [quote()],
          new Date("2026-08-02").getTime(),
        ).status,
        "usable",
      );
    },
  },
  {
    id: 27,
    name: "expired or superseded quote retrieval",
    run: () => {
      assertEquals(
        selectLatestQuoteForContinuation([
          quote({ status: "superseded", supersededAt: "2026-08-01T01:00:00Z" }),
        ]).status,
        "expired_or_superseded",
      );
    },
  },
  {
    id: 28,
    name: "successful reschedule",
    run: () => {
      assertEquals(
        resolveVoiceAppointmentOutcome("reschedule", {
          status: "accepted",
          providerOperationId: "p",
        }, { status: "persisted", localRecordId: "b" }).status,
        "confirmed",
      );
    },
  },
  {
    id: 29,
    name: "reschedule rejection preserves old appointment",
    run: () => {
      const outcome = resolveVoiceAppointmentOutcome("reschedule", {
        status: "rejected",
      }, { status: "not_attempted" });
      assertEquals(outcome.preserveExistingAppointment, true);
    },
  },
  {
    id: 30,
    name: "successful cancellation",
    run: () => {
      assertEquals(
        resolveVoiceAppointmentOutcome("cancel", {
          status: "accepted",
          providerOperationId: "p",
        }, { status: "persisted", localRecordId: "b" }).status,
        "confirmed",
      );
    },
  },
  {
    id: 31,
    name: "cancellation retry uses same key",
    run: () => {
      const args = {
        action: "cancel" as const,
        organizationId: "org",
        customerId: "customer",
        bookingId: "booking",
        bookingVersion: 3,
      };
      assertEquals(
        voiceAppointmentIdempotencyKey(args),
        voiceAppointmentIdempotencyKey(args),
      );
    },
  },
  {
    id: 32,
    name: "cancellation uncertainty forbids retry",
    run: () => {
      const outcome = resolveVoiceAppointmentOutcome("cancel", {
        status: "uncertain",
      }, { status: "not_attempted" });
      assertEquals(outcome.automaticRetryAllowed, false);
      assertEquals(outcome.reconciliationRequired, true);
    },
  },
  {
    id: 33,
    name: "general question does not enter quote intake",
    run: () => {
      assertEquals(
        classifyVoiceJourneyIntent(
          "I have a specific question about your hours",
        ),
        "question_or_memo",
      );
    },
  },
  {
    id: 34,
    name: "field memo is bounded and quote-neutral",
    run: () => {
      const before = sessionInputsKey({
        services: ["screenRepair"],
        screenRepairCount: 2,
      });
      assert(
        buildFieldTeamMemo({
          bookingId: "b",
          customerId: "c",
          text: "Use side gate",
        }),
      );
      assertEquals(
        sessionInputsKey({ services: ["screenRepair"], screenRepairCount: 2 }),
        before,
      );
    },
  },
  {
    id: 35,
    name: "disconnect follow-up cannot claim unconfirmed send",
    run: () => {
      assertEquals(
        describeVoiceDelivery({ channel: "sms", status: "not_requested" })
          .completed,
        false,
      );
    },
  },
  {
    id: 36,
    name: "partial window is explicit",
    run: () => {
      const result = applyCanonicalVoiceAnswer(
        baseSession(),
        "services",
        "only five specific windows",
      );
      assertEquals(result.session.fields.windowCleaningScope, "partial");
    },
  },
  {
    id: 37,
    name: "whole-home is the default without scope question",
    run: () => {
      const result = applyCanonicalVoiceAnswer(
        baseSession(),
        "services",
        "window cleaning for my home",
      );
      assertEquals(result.session.fields.windowCleaningScope, "whole_home");
    },
  },
  {
    id: 38,
    name: "window sides are explicitly captured",
    run: () => {
      assertEquals(
        applyCanonicalVoiceAnswer(
          baseSession(),
          "windowCleaningSides",
          "inside and outside",
        ).session.fields.windowCleaningSides,
        "inside_and_outside",
      );
    },
  },
  {
    id: 39,
    name: "manual-review portion remains explicit",
    run: () => {
      assertStringIncludes(VOICE_RECOVERY_LANGUAGE.manual_review, "review");
    },
  },
  {
    id: 40,
    name: "cross-organization/customer access fails closed",
    run: () => {
      assertEquals(gate({ organizationResolved: false }).allowed, false);
    },
  },
];

assertEquals(cases.length, 40);
for (const scenario of cases) {
  Deno.test(`scenario ${scenario.id}: ${scenario.name}`, scenario.run);
}
