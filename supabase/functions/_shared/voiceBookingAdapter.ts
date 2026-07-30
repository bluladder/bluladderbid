export type VoiceBookingMode = "disabled" | "dry_run" | "live";

export type TrustedVoiceCallContext = {
  provider: "vapi";
  providerCallId: string;
  conversationId: string;
  authenticatedProviderEvent: boolean;
  providerResourceTrusted: boolean;
  organizationResolution:
    | { status: "resolved"; organizationId: string }
    | { status: "missing" | "conflict" | "inactive" };
};

export type VoiceBookingEvidence = {
  explicitConfirmation: boolean;
  serviceAddress: string;
  serviceAreaStatus: "eligible" | "ineligible" | "ambiguous" | "unavailable";
  quoteSignature: string;
  offerVersion: string;
  offerExpiresAt: string;
  slotId: string;
};

export type VoiceBookingDecision =
  | {
    status: "blocked";
    code:
      | "adapter_disabled"
      | "untrusted_call"
      | "organization_missing"
      | "organization_conflict"
      | "organization_inactive"
      | "address_unverified"
      | "unsupported_territory"
      | "quote_missing"
      | "offer_missing"
      | "offer_expired"
      | "confirmation_missing";
  }
  | {
    status: "dry_run_ready" | "live_ready";
    receiptId: string;
    idempotencyKey: string;
    commandHash: string;
    /** true for dry runs (nothing is written), false when a live provider
     *  write is authorized to proceed through the shared booking pipeline. */
    noProviderWrite: boolean;
  };

export function resolveVoiceBookingMode(
  value: string | undefined,
): VoiceBookingMode {
  if (value === "live") return "live";
  return value === "dry_run" ? "dry_run" : "disabled";
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function prepareVoiceBooking(
  mode: VoiceBookingMode,
  context: TrustedVoiceCallContext,
  evidence: VoiceBookingEvidence,
): Promise<VoiceBookingDecision> {
  if (mode !== "dry_run" && mode !== "live") {
    return { status: "blocked", code: "adapter_disabled" };
  }
  if (!context.authenticatedProviderEvent || !context.providerResourceTrusted) {
    return { status: "blocked", code: "untrusted_call" };
  }
  if (context.organizationResolution.status !== "resolved") {
    return {
      status: "blocked",
      code: `organization_${context.organizationResolution.status}`,
    };
  }
  if (
    !evidence.serviceAddress.trim() ||
    evidence.serviceAreaStatus === "ambiguous" ||
    evidence.serviceAreaStatus === "unavailable"
  ) {
    return { status: "blocked", code: "address_unverified" };
  }
  if (evidence.serviceAreaStatus === "ineligible") {
    return { status: "blocked", code: "unsupported_territory" };
  }
  if (!evidence.quoteSignature) {
    return { status: "blocked", code: "quote_missing" };
  }
  if (!evidence.offerVersion || !evidence.slotId) {
    return { status: "blocked", code: "offer_missing" };
  }
  const offerExpiresAt = new Date(evidence.offerExpiresAt).getTime();
  if (!Number.isFinite(offerExpiresAt) || Date.now() >= offerExpiresAt) {
    return { status: "blocked", code: "offer_expired" };
  }
  if (!evidence.explicitConfirmation) {
    return { status: "blocked", code: "confirmation_missing" };
  }

  const organizationId = context.organizationResolution.organizationId;
  const idempotencyKey = [
    "voice_booking",
    context.provider,
    context.providerCallId,
    context.conversationId,
    organizationId,
    evidence.offerVersion,
    evidence.slotId,
    evidence.quoteSignature,
  ].join(":");
  const commandHash = await sha256(JSON.stringify({
    organizationId,
    conversationId: context.conversationId,
    serviceAddress: evidence.serviceAddress.trim(),
    quoteSignature: evidence.quoteSignature,
    offerVersion: evidence.offerVersion,
    slotId: evidence.slotId,
  }));
  return {
    status: mode === "live" ? "live_ready" : "dry_run_ready",
    receiptId: `${mode === "live" ? "live" : "dry-run"}:${
      commandHash.slice(0, 24)
    }`,
    idempotencyKey,
    commandHash,
    noProviderWrite: mode !== "live",
  };
}
