import { deterministicUuid } from "../deterministicUuid.ts";

export const VOICE_GENERATED_QUOTE_PURPOSE = "voice_generated_quote";
export const VOICE_GENERATED_QUOTE_CHANNEL = "sms";

export interface VoiceGeneratedQuoteFingerprintInput {
  inputsKey: string;
  engineVersion?: string | null;
  pricingVersion?: string | number | null;
  taxPolicyVersion?: string | null;
  durationVersion?: string | null;
  total: number;
  serviceSubtotal?: number | null;
  estimatedTax?: number | null;
  estimatedDurationMinutes?: number | null;
  promotionId?: string | null;
  discountCode?: string | null;
  lineItems?: unknown[] | null;
}

export interface VoiceGeneratedQuoteDeliveryIdentityInput {
  organizationId: string;
  conversationId: string;
  quoteSessionId: string;
  quoteFingerprint: string;
  recipientE164: string;
}

export interface VoiceGeneratedQuoteDeliveryIdentity {
  key: string;
  recipientHash: string;
  purpose: typeof VOICE_GENERATED_QUOTE_PURPOSE;
  channel: typeof VOICE_GENERATED_QUOTE_CHANNEL;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Fingerprint the complete authoritative quote version without exposing the
 * quote inputs, prices, recipient or customer data in durable identifiers.
 */
export async function buildVoiceGeneratedQuoteFingerprint(
  input: VoiceGeneratedQuoteFingerprintInput,
): Promise<string> {
  return await deterministicUuid(
    "voice-generated-quote-fingerprint-v1",
    input.inputsKey,
    String(input.engineVersion ?? ""),
    String(input.pricingVersion ?? ""),
    String(input.taxPolicyVersion ?? ""),
    String(input.durationVersion ?? ""),
    String(input.total),
    String(input.serviceSubtotal ?? ""),
    String(input.estimatedTax ?? ""),
    String(input.estimatedDurationMinutes ?? ""),
    String(input.promotionId ?? ""),
    String(input.discountCode ?? ""),
    canonicalJson(input.lineItems ?? []),
  );
}

/**
 * Bind one generated-quote delivery to tenant, conversation, quote session,
 * exact quote fingerprint, recipient, channel and purpose. Only the resulting
 * UUID-shaped hashes are persisted; the phone number never enters the key.
 */
export async function buildVoiceGeneratedQuoteDeliveryIdentity(
  input: VoiceGeneratedQuoteDeliveryIdentityInput,
): Promise<VoiceGeneratedQuoteDeliveryIdentity> {
  const recipientHash = await deterministicUuid(
    "voice-generated-quote-recipient-v1",
    input.organizationId,
    input.conversationId,
    input.quoteSessionId,
    input.quoteFingerprint,
    input.recipientE164,
  );
  const id = await deterministicUuid(
    "voice-generated-quote-delivery-v1",
    input.organizationId,
    input.conversationId,
    input.quoteSessionId,
    input.quoteFingerprint,
    recipientHash,
    VOICE_GENERATED_QUOTE_CHANNEL,
    VOICE_GENERATED_QUOTE_PURPOSE,
  );
  return {
    key:
      `${VOICE_GENERATED_QUOTE_PURPOSE}:${VOICE_GENERATED_QUOTE_CHANNEL}:${id}`,
    recipientHash,
    purpose: VOICE_GENERATED_QUOTE_PURPOSE,
    channel: VOICE_GENERATED_QUOTE_CHANNEL,
  };
}

export function isVoiceGeneratedQuoteDeliveryKey(value: unknown): boolean {
  return typeof value === "string" &&
    /^voice_generated_quote:sms:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(value);
}
