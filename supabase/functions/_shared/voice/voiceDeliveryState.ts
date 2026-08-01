// Provider-neutral delivery truth for voice. A provider acceptance is the only
// state allowed to use past-tense "sent" language.

export type VoiceDeliveryChannel = "sms" | "email";
export type VoiceDeliveryStatus =
  | "not_requested"
  | "pending"
  | "queued"
  | "provider_accepted"
  | "delivered"
  | "retry_pending"
  | "uncertain"
  | "failed_terminal";

export interface VoiceDeliveryReceipt {
  channel: VoiceDeliveryChannel;
  status: VoiceDeliveryStatus;
  attemptId?: string | null;
  providerMessageId?: string | null;
  retryAt?: string | null;
  reasonCode?: string | null;
}

export interface VoiceDeliveryMessage {
  completed: boolean;
  retryExpected: boolean;
  event: string;
  spoken: string;
}

export function describeVoiceDelivery(
  receipt: VoiceDeliveryReceipt,
): VoiceDeliveryMessage {
  const noun = receipt.channel === "sms" ? "text" : "email";
  switch (receipt.status) {
    case "not_requested":
      return {
        completed: false,
        retryExpected: false,
        event: `voice_${receipt.channel}_not_requested`,
        spoken: `No ${noun} has been requested or sent.`,
      };
    case "pending":
      return {
        completed: false,
        retryExpected: false,
        event: `voice_${receipt.channel}_pending`,
        spoken: `The ${noun} request is pending. I can't call it sent yet.`,
      };
    case "provider_accepted":
      return {
        completed: true,
        retryExpected: false,
        event: `voice_${receipt.channel}_provider_accepted`,
        spoken: `The ${noun} has been accepted for delivery.`,
      };
    case "delivered":
      return {
        completed: true,
        retryExpected: false,
        event: `voice_${receipt.channel}_delivered`,
        spoken: `The provider confirmed that the ${noun} was delivered.`,
      };
    case "queued":
      return {
        completed: false,
        retryExpected: true,
        event: `voice_${receipt.channel}_queued`,
        spoken:
          `Your ${noun} is queued, but I can't say it has been delivered yet.`,
      };
    case "retry_pending":
      return {
        completed: false,
        retryExpected: true,
        event: `voice_${receipt.channel}_retry_pending`,
        spoken:
          `The first ${noun} attempt did not complete, and a retry is pending. I can't call it sent yet.`,
      };
    case "uncertain":
      return {
        completed: false,
        retryExpected: false,
        event: `voice_${receipt.channel}_uncertain`,
        spoken:
          `The ${noun} request reached the delivery system, but the provider outcome is uncertain. I can't confirm that it was sent.`,
      };
    case "failed_terminal":
      return {
        completed: false,
        retryExpected: false,
        event: `voice_${receipt.channel}_failed`,
        spoken:
          `That ${noun} was not sent. I can keep helping here or have a teammate follow up.`,
      };
  }
}

/** Collapse existing email/outbox status names into the voice contract. */
export function normalizeDeliveryStatus(status: unknown): VoiceDeliveryStatus {
  switch (status) {
    case "not_requested":
      return "not_requested";
    case "pending":
      return "pending";
    case "delivered":
      return "delivered";
    case "provider_accepted":
    case "accepted":
    case "sent":
      return "provider_accepted";
    case "queued":
    case "provider_submission_pending":
      return "queued";
    case "retry_pending":
    case "failed_retryable":
    case "send_failed":
      return "retry_pending";
    case "uncertain":
    case "delivery_unknown":
      return "uncertain";
    default:
      return "failed_terminal";
  }
}
