// Deterministic truth boundary for voice booking, reschedule, and cancellation
// mutations. Provider adapters perform the external call; this module decides
// what may be claimed and whether a retry is safe. It contains no credentials
// and performs no I/O.

export type VoiceAppointmentAction = "book" | "reschedule" | "cancel";

export type ProviderMutationResult =
  | { status: "accepted"; providerOperationId: string }
  | { status: "rejected"; reasonCode?: string | null }
  | { status: "unavailable"; reasonCode?: string | null }
  | { status: "timeout" | "uncertain"; reasonCode?: string | null };

export type LocalMutationResult =
  | { status: "persisted"; localRecordId: string }
  | { status: "failed"; reasonCode?: string | null }
  | { status: "not_attempted" };

export type VoiceAppointmentOutcomeStatus =
  | "confirmed"
  | "provider_rejected"
  | "provider_unavailable"
  | "provider_outcome_uncertain"
  | "provider_accepted_local_unconfirmed";

export interface VoiceAppointmentOutcome {
  status: VoiceAppointmentOutcomeStatus;
  customerMayHearSuccess: boolean;
  automaticRetryAllowed: boolean;
  reconciliationRequired: boolean;
  preserveExistingAppointment: boolean;
  spoken: string;
}

const successfulLanguage: Record<VoiceAppointmentAction, string> = {
  book: "Your appointment is confirmed.",
  reschedule:
    "Your appointment has been rescheduled and the new time is confirmed.",
  cancel: "Your appointment cancellation is confirmed.",
};

const rejectedLanguage: Record<VoiceAppointmentAction, string> = {
  book:
    "The appointment was not booked. I can check the current options again.",
  reschedule:
    "The appointment was not changed. Your existing time remains in place.",
  cancel:
    "The cancellation was not accepted, so I am not calling the appointment cancelled.",
};

/**
 * Convert provider + local persistence evidence into one customer-safe truth.
 * An accepted external mutation with failed local persistence is deliberately
 * non-retryable: repeating it could duplicate or reverse provider state.
 */
export function resolveVoiceAppointmentOutcome(
  action: VoiceAppointmentAction,
  provider: ProviderMutationResult,
  local: LocalMutationResult,
): VoiceAppointmentOutcome {
  if (provider.status === "accepted") {
    if (local.status === "persisted") {
      return {
        status: "confirmed",
        customerMayHearSuccess: true,
        automaticRetryAllowed: false,
        reconciliationRequired: false,
        preserveExistingAppointment: false,
        spoken: successfulLanguage[action],
      };
    }
    return {
      status: "provider_accepted_local_unconfirmed",
      customerMayHearSuccess: false,
      automaticRetryAllowed: false,
      reconciliationRequired: true,
      preserveExistingAppointment: action !== "book",
      spoken:
        "The scheduling provider accepted the request, but I could not verify our local record. Please do not repeat the request; our team needs to reconcile it.",
    };
  }
  if (provider.status === "rejected") {
    return {
      status: "provider_rejected",
      customerMayHearSuccess: false,
      automaticRetryAllowed: action === "book",
      reconciliationRequired: false,
      preserveExistingAppointment: action !== "book",
      spoken: rejectedLanguage[action],
    };
  }
  if (provider.status === "unavailable") {
    return {
      status: "provider_unavailable",
      customerMayHearSuccess: false,
      automaticRetryAllowed: false,
      reconciliationRequired: false,
      preserveExistingAppointment: action !== "book",
      spoken:
        "I cannot confirm the scheduling provider right now, so I have not called the request complete. I can preserve it for follow-up.",
    };
  }
  return {
    status: "provider_outcome_uncertain",
    customerMayHearSuccess: false,
    automaticRetryAllowed: false,
    reconciliationRequired: true,
    preserveExistingAppointment: action !== "book",
    spoken:
      "The provider outcome is uncertain. I will not repeat the request or claim it succeeded until our team verifies it.",
  };
}

/** Stable, non-secret idempotency scope for the exact verified mutation. */
export function voiceAppointmentIdempotencyKey(args: {
  action: VoiceAppointmentAction;
  organizationId: string;
  customerId: string;
  bookingId?: string | null;
  bookingVersion?: number | null;
  quoteIdentity?: string | null;
  targetStart?: string | null;
}): string {
  return [
    "voice_appointment",
    args.action,
    args.organizationId,
    args.customerId,
    args.bookingId ?? "new",
    String(args.bookingVersion ?? 0),
    args.quoteIdentity ?? "no_quote",
    args.targetStart ?? "no_target",
  ].map((value) => encodeURIComponent(value)).join(":");
}

export type SlotRevalidationResult =
  | { status: "current" }
  | { status: "slot_lost" | "schedule_stale" | "provider_unavailable" };

export function canAttemptAppointmentMutation(args: {
  action: VoiceAppointmentAction;
  identityResolved: boolean;
  organizationResolved: boolean;
  exactRecordSelected: boolean;
  explicitFinalConfirmation: boolean;
  quoteIdentityCurrent: boolean;
  durationAvailable: boolean;
  serviceAreaEligible: boolean;
  slotRevalidation?: SlotRevalidationResult | null;
}): { allowed: true } | { allowed: false; reason: string; spoken: string } {
  if (!args.identityResolved) {
    return {
      allowed: false,
      reason: "identity_required",
      spoken:
        "I need to verify the customer before I can access or change an appointment.",
    };
  }
  if (!args.organizationResolved) {
    return {
      allowed: false,
      reason: "organization_unresolved",
      spoken:
        "I cannot safely resolve the account for this request, so no appointment was changed.",
    };
  }
  if (!args.exactRecordSelected) {
    return {
      allowed: false,
      reason: "appointment_ambiguous",
      spoken:
        "I need to identify the exact appointment before anything can be changed.",
    };
  }
  if (!args.explicitFinalConfirmation) {
    return {
      allowed: false,
      reason: "confirmation_required",
      spoken:
        "I have not made that change. Please explicitly confirm the exact appointment action first.",
    };
  }
  if (args.action === "book" && !args.quoteIdentityCurrent) {
    return {
      allowed: false,
      reason: "stale_quote",
      spoken:
        "The quote is no longer current, so I need to verify the latest price before booking.",
    };
  }
  if (args.action !== "cancel" && !args.durationAvailable) {
    return {
      allowed: false,
      reason: "duration_unavailable",
      spoken:
        "I do not have an authoritative job duration, so I cannot safely choose an appointment time.",
    };
  }
  if (args.action === "book" && !args.serviceAreaEligible) {
    return {
      allowed: false,
      reason: "service_area_unverified",
      spoken: "I need to confirm the service area before booking.",
    };
  }
  if (args.action !== "cancel" && args.slotRevalidation?.status !== "current") {
    const reason = args.slotRevalidation?.status ?? "slot_not_revalidated";
    return {
      allowed: false,
      reason,
      spoken: reason === "slot_lost"
        ? "That time is no longer available. No appointment was changed, and I can check current options again."
        : "I cannot confirm the current schedule, so I will not guess or change the appointment.",
    };
  }
  return { allowed: true };
}
