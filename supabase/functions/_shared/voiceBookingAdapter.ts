import { resolveAuthoritativeDuration } from "./salesEngine/durationContract.ts";
import { validatePublicBookingCustomer } from "./publicBookingCustomer.ts";
import type { QuoteIdentity } from "./voice/voiceJourneyContract.ts";
import { voiceAppointmentIdempotencyKey } from "./voice/voiceAppointmentRecovery.ts";

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

export type CanonicalVoiceBookingLineItem = {
  name: string;
  price: number;
  description?: string;
};

export type CanonicalVoiceBookingPriceAdjustment = {
  key: string;
  label: string;
  kind: "discount" | "surcharge";
  amount: number;
  appliesToLineItemKey?: string;
};

export type CanonicalVoiceBookingPromotion = {
  id: string;
  version: number;
  flatPrice: number;
  maxWindows: number;
  windowCount: number;
  prepInstructions: string;
  terms?: string;
};

export interface CanonicalVoiceBookingCommandInput {
  /** Opaque internal voice-session token. Only its SHA-256 fingerprint leaves this boundary. */
  voiceSessionToken: string;
  organizationId: string;
  conversationId: string;
  customerId: string;
  propertyId: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  serviceAddress: string;
  quoteIdentity: QuoteIdentity;
  bookingInputsKey: string;
  quote: Record<string, unknown>;
  selectedServiceIds: string[];
  homeDetails: Record<string, unknown>;
  additionalServices: Record<string, unknown>;
  offer: {
    offerVersion: string;
    offerExpiresAt: string;
    slotId: string;
    scheduledStart: string;
    scheduledEnd: string;
    timezone: string;
    durationMinutes: number;
    technicianId: string;
    isTeamJob: boolean;
    teamTechnicianIds: string[];
  };
}

export interface CanonicalVoiceBookingContract {
  version: "canonical_voice_booking_v1";
  provider: "vapi";
  voiceSessionFingerprint: string;
  organizationId: string;
  conversationId: string;
  customerId: string;
  propertyId: string;
  quoteSessionId: string;
  quoteId: string | null;
  quoteFingerprint: string;
  bookingInputsKey: string;
  offerVersion: string;
  offerExpiresAt: string;
  slotId: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  durationMinutes: number;
  subtotal: number;
  estimatedTax: number;
  total: number;
  durationVersion: string | null;
  engineVersion: string | null;
  pricingVersion: number | string | null;
  taxPolicyVersion: string | null;
  idempotencyKey: string;
  commandHash: string;
}

export interface CanonicalVoiceBookingPayload {
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
  };
  technicianId: string;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number;
  services: CanonicalVoiceBookingLineItem[];
  selectedServiceIds: string[];
  homeDetails: Record<string, unknown>;
  additionalServices: Record<string, unknown>;
  promotion: { id: string; windowCount: number } | null;
  promotionContext: CanonicalVoiceBookingPromotion | null;
  priceAdjustments: CanonicalVoiceBookingPriceAdjustment[];
  subtotal: number;
  taxableSubtotal: number;
  estimatedTax: number;
  preTaxTotal: number;
  total: number;
  taxRate: number;
  taxLabel: string;
  discountAmount: number;
  discountCode?: string;
  discountContext: Record<string, unknown> | null;
  isTeamJob: boolean;
  teamTechnicianIds: string[];
  idempotencyKey: string;
  sessionId: string;
  voiceContract: CanonicalVoiceBookingContract;
}

export type CanonicalVoiceBookingBuildResult =
  | { ok: true; payload: CanonicalVoiceBookingPayload }
  | {
    ok: false;
    code:
      | "identity_incomplete"
      | "address_incomplete"
      | "quote_incomplete"
      | "duration_unavailable"
      | "offer_incomplete"
      | "offer_expired"
      | "slot_duration_mismatch";
  };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function exactIntervalMinutes(start: string, end: string): number | null {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (
    !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs
  ) {
    return null;
  }
  const minutes = (endMs - startMs) / 60_000;
  return Number.isInteger(minutes) && minutes > 0 ? minutes : null;
}

function semanticCommandValue(
  payload: Omit<CanonicalVoiceBookingPayload, "voiceContract">,
  contract: Omit<CanonicalVoiceBookingContract, "commandHash">,
): Record<string, unknown> {
  return {
    version: contract.version,
    provider: contract.provider,
    voiceSessionFingerprint: contract.voiceSessionFingerprint,
    organizationId: contract.organizationId,
    conversationId: contract.conversationId,
    customerId: contract.customerId,
    propertyId: contract.propertyId,
    quoteSessionId: contract.quoteSessionId,
    quoteId: contract.quoteId,
    quoteFingerprint: contract.quoteFingerprint,
    bookingInputsKey: contract.bookingInputsKey,
    offerVersion: contract.offerVersion,
    offerExpiresAt: contract.offerExpiresAt,
    slotId: contract.slotId,
    scheduledStart: contract.scheduledStart,
    scheduledEnd: contract.scheduledEnd,
    timezone: contract.timezone,
    durationMinutes: contract.durationMinutes,
    durationVersion: contract.durationVersion,
    engineVersion: contract.engineVersion,
    pricingVersion: contract.pricingVersion,
    taxPolicyVersion: contract.taxPolicyVersion,
    idempotencyKey: contract.idempotencyKey,
    customer: payload.customer,
    services: payload.services,
    selectedServiceIds: payload.selectedServiceIds,
    homeDetails: payload.homeDetails,
    additionalServices: payload.additionalServices,
    promotion: payload.promotion,
    promotionContext: payload.promotionContext,
    priceAdjustments: payload.priceAdjustments,
    subtotal: payload.subtotal,
    taxableSubtotal: payload.taxableSubtotal,
    estimatedTax: payload.estimatedTax,
    preTaxTotal: payload.preTaxTotal,
    total: payload.total,
    taxRate: payload.taxRate,
    taxLabel: payload.taxLabel,
    discountAmount: payload.discountAmount,
    discountCode: payload.discountCode ?? null,
    discountContext: payload.discountContext,
    technicianId: payload.technicianId,
    isTeamJob: payload.isTeamJob,
    teamTechnicianIds: payload.teamTechnicianIds,
    sessionId: payload.sessionId,
  };
}

export async function fingerprintVoiceSessionToken(
  token: string,
): Promise<string> {
  return token.trim() ? await sha256(token) : "";
}

export async function buildCanonicalVoiceBookingPayload(
  input: CanonicalVoiceBookingCommandInput,
  nowMs = Date.now(),
): Promise<CanonicalVoiceBookingBuildResult> {
  const normalizedCustomer = validatePublicBookingCustomer({
    ...input.customer,
    address: input.serviceAddress,
  });
  if (!normalizedCustomer.ok) {
    return {
      ok: false,
      code: normalizedCustomer.code === "INCOMPLETE_SERVICE_ADDRESS"
        ? "address_incomplete"
        : "identity_incomplete",
    };
  }
  const { firstName, lastName, email, phone, address: serviceAddress } =
    normalizedCustomer.customer;
  if (
    !text(input.organizationId) || !text(input.conversationId) ||
    !text(input.customerId) || !text(input.propertyId) || !firstName ||
    !lastName || !email || !phone || !text(input.voiceSessionToken)
  ) return { ok: false, code: "identity_incomplete" };

  const duration = resolveAuthoritativeDuration(input.quote);
  if (duration.status !== "available") {
    return { ok: false, code: "duration_unavailable" };
  }
  const scheduledStart = text(input.offer.scheduledStart);
  const scheduledEnd = text(input.offer.scheduledEnd);
  const intervalMinutes = exactIntervalMinutes(scheduledStart, scheduledEnd);
  if (
    input.offer.durationMinutes !== duration.minutes ||
    intervalMinutes !== duration.minutes
  ) return { ok: false, code: "slot_duration_mismatch" };
  const offerExpiresAt = new Date(input.offer.offerExpiresAt).getTime();
  if (!Number.isFinite(offerExpiresAt)) {
    return { ok: false, code: "offer_incomplete" };
  }
  if (offerExpiresAt <= nowMs) return { ok: false, code: "offer_expired" };
  if (
    !text(input.offer.offerVersion) || !text(input.offer.slotId) ||
    !text(input.offer.timezone) || !text(input.offer.technicianId)
  ) return { ok: false, code: "offer_incomplete" };

  const q = input.quote;
  const serviceSubtotal = money(q.serviceSubtotal);
  const taxableSubtotal = money(q.taxableSubtotal);
  const estimatedTax = money(q.estimatedTax);
  const preTaxTotal = money(q.total);
  const estimatedTotal = money(q.estimatedTotal);
  const taxRate = money(q.taxRate);
  const taxLabel = text(q.taxLabel);
  const jobberLineItems = Array.isArray(q.jobberLineItems)
    ? q.jobberLineItems
    : [];
  const services = jobberLineItems.map((raw) => {
    const row = raw as Record<string, unknown>;
    return {
      name: text(row.name),
      price: money(row.unitPrice),
      ...(text(row.description) ? { description: text(row.description) } : {}),
    };
  });
  if (
    serviceSubtotal === null || taxableSubtotal === null ||
    estimatedTax === null || preTaxTotal === null || estimatedTotal === null ||
    taxRate === null || !taxLabel || services.length === 0 ||
    services.some((item) => !item.name || item.price === null) ||
    input.selectedServiceIds.length === 0 ||
    !text(input.quoteIdentity.inputsKey) ||
    !text(input.quoteIdentity.quoteSessionId) || !text(input.bookingInputsKey)
  ) return { ok: false, code: "quote_incomplete" };

  const priceAdjustments = Array.isArray(q.priceAdjustments)
    ? q.priceAdjustments.map((raw) => ({
      ...(raw as CanonicalVoiceBookingPriceAdjustment),
    }))
    : [];
  const validAdjustments = priceAdjustments.every((adjustment) =>
    !!text(adjustment.key) && !!text(adjustment.label) &&
    (adjustment.kind === "discount" || adjustment.kind === "surcharge") &&
    money(adjustment.amount) !== null
  );
  if (!validAdjustments) return { ok: false, code: "quote_incomplete" };

  const discount = q.discount && typeof q.discount === "object"
    ? q.discount as Record<string, unknown>
    : null;
  const discountAmount = discount ? money(discount.amount) : 0;
  if (discountAmount === null) return { ok: false, code: "quote_incomplete" };
  const promotionContext = q.promotion && typeof q.promotion === "object"
    ? q.promotion as CanonicalVoiceBookingPromotion
    : null;
  const promotion = promotionContext
    ? {
      id: text(promotionContext.id),
      windowCount: promotionContext.windowCount,
    }
    : null;
  if (
    promotion &&
    (!promotion.id || !Number.isInteger(promotion.windowCount) ||
      promotion.windowCount <= 0)
  ) return { ok: false, code: "quote_incomplete" };

  const idempotencyKey = voiceAppointmentIdempotencyKey({
    action: "book",
    organizationId: input.organizationId,
    customerId: input.customerId,
    quoteIdentity: [
      input.quoteIdentity.quoteSessionId,
      input.quoteIdentity.inputsKey,
      input.bookingInputsKey,
      input.propertyId,
      scheduledEnd,
    ].join("|"),
    targetStart: scheduledStart,
  });
  const contractWithoutHash: Omit<
    CanonicalVoiceBookingContract,
    "commandHash"
  > = {
    version: "canonical_voice_booking_v1",
    provider: "vapi",
    voiceSessionFingerprint: await fingerprintVoiceSessionToken(
      input.voiceSessionToken,
    ),
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    customerId: input.customerId,
    propertyId: input.propertyId,
    quoteSessionId: input.quoteIdentity.quoteSessionId,
    quoteId: input.quoteIdentity.quoteId,
    quoteFingerprint: input.quoteIdentity.inputsKey,
    bookingInputsKey: input.bookingInputsKey,
    offerVersion: input.offer.offerVersion,
    offerExpiresAt: input.offer.offerExpiresAt,
    slotId: input.offer.slotId,
    scheduledStart,
    scheduledEnd,
    timezone: input.offer.timezone,
    durationMinutes: duration.minutes,
    subtotal: serviceSubtotal,
    estimatedTax,
    total: estimatedTotal,
    durationVersion: input.quoteIdentity.durationVersion,
    engineVersion: input.quoteIdentity.engineVersion,
    pricingVersion: input.quoteIdentity.pricingVersion,
    taxPolicyVersion: input.quoteIdentity.taxPolicyVersion,
    idempotencyKey,
  };
  const payloadWithoutContract: Omit<
    CanonicalVoiceBookingPayload,
    "voiceContract"
  > = {
    customer: { firstName, lastName, email, phone, address: serviceAddress },
    technicianId: input.offer.technicianId,
    scheduledStart,
    scheduledEnd,
    durationMinutes: duration.minutes,
    services: services as CanonicalVoiceBookingLineItem[],
    selectedServiceIds: [...input.selectedServiceIds],
    homeDetails: input.homeDetails,
    additionalServices: input.additionalServices,
    promotion,
    promotionContext,
    priceAdjustments,
    subtotal: serviceSubtotal,
    taxableSubtotal,
    estimatedTax,
    preTaxTotal,
    total: estimatedTotal,
    taxRate,
    taxLabel,
    discountAmount,
    ...(discount && text(discount.code)
      ? { discountCode: text(discount.code) }
      : {}),
    discountContext: discount,
    isTeamJob: input.offer.isTeamJob,
    teamTechnicianIds: [...input.offer.teamTechnicianIds],
    idempotencyKey,
    sessionId: input.quoteIdentity.quoteSessionId,
  };
  const commandHash = await sha256(JSON.stringify(
    semanticCommandValue(payloadWithoutContract, contractWithoutHash),
  ));
  return {
    ok: true,
    payload: {
      ...payloadWithoutContract,
      voiceContract: { ...contractWithoutHash, commandHash },
    },
  };
}

export async function validateCanonicalVoiceBookingPayload(
  payload: CanonicalVoiceBookingPayload,
): Promise<boolean> {
  const contract = payload?.voiceContract;
  if (
    !contract || contract.version !== "canonical_voice_booking_v1" ||
    contract.provider !== "vapi" ||
    !contract.voiceSessionFingerprint ||
    contract.idempotencyKey !== payload.idempotencyKey ||
    contract.quoteSessionId !== payload.sessionId ||
    contract.scheduledStart !== payload.scheduledStart ||
    contract.scheduledEnd !== payload.scheduledEnd ||
    contract.durationMinutes !== payload.durationMinutes ||
    contract.subtotal !== payload.subtotal ||
    contract.estimatedTax !== payload.estimatedTax ||
    contract.total !== payload.total
  ) return false;
  const { voiceContract: _voiceContract, ...withoutContract } = payload;
  const { commandHash: _commandHash, ...withoutHash } = contract;
  const expected = await sha256(JSON.stringify(
    semanticCommandValue(withoutContract, withoutHash),
  ));
  return expected === contract.commandHash;
}

export function canonicalVoiceBookingResultMatches(
  contract: CanonicalVoiceBookingContract,
  result: Record<string, unknown> | null | undefined,
): boolean {
  if (!result) return false;
  return result.success === true && result.providerStatus === "accepted" &&
    result.localStatus === "persisted" &&
    typeof result.jobberJobId === "string" && !!result.jobberJobId &&
    typeof result.jobberVisitId === "string" && !!result.jobberVisitId &&
    typeof result.bookingId === "string" && !!result.bookingId &&
    result.organizationId === contract.organizationId &&
    result.customerId === contract.customerId &&
    result.propertyId === contract.propertyId &&
    result.quoteFingerprint === contract.quoteFingerprint &&
    result.bookingInputsKey === contract.bookingInputsKey &&
    result.offerVersion === contract.offerVersion &&
    result.slotId === contract.slotId &&
    result.scheduledStart === contract.scheduledStart &&
    result.scheduledEnd === contract.scheduledEnd &&
    result.durationMinutes === contract.durationMinutes &&
    result.idempotencyKey === contract.idempotencyKey &&
    result.commandHash === contract.commandHash &&
    result.subtotal === contract.subtotal &&
    result.estimatedTax === contract.estimatedTax &&
    result.total === contract.total;
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
