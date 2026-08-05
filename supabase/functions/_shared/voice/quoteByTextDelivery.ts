// ============================================================================
// quoteByTextDelivery — the canonical, customer-facing delivery closure used by
// the truthful voice quote-by-text rail.
//
// This module owns NO provider call and NO pricing of its own. It composes two
// already-deployed canonical paths, in this order:
//
//   1. `save-quote`  — server-authoritative recalculation, customer resolution,
//                      organization resolution, resume-token minting, and the
//                      `quote_calculated` campaign emission. Called with
//                      action:"save" so NO email is ever sent from a voice call.
//   2. `send-sms`    — eventType:"quote_created" with customerInitiated:true.
//                      That path mints a fresh opaque resume URL and dispatches
//                      through an exact, privacy-safe delivery identity binding
//                      tenant, conversation, quote session/fingerprint,
//                      recipient, channel, and purpose
//                      with opt-out, per-lead pause, and test-identity
//                      suppression enforced immediately before delivery.
//
// The returned `ok` is true ONLY when send-sms reports the transactional
// message was actually accepted by the provider. Anything else resolves false
// so `planQuoteByTextResponse` keeps telling the caller the truth.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import type { ConversationFacts } from "../conversationState.ts";
import { isQuoteFirm } from "../conversationState.ts";
import { buildQuoteRequest } from "../aiTools.ts";
import { quoteSessionFieldsToQuoteInput } from "../quoteSessionPricingAdapter.ts";
import type { QuoteInput } from "../pricingEngine.ts";
import { PUBLIC_BOOKING_ORGANIZATION_ID } from "../publicBookingServiceArea.ts";
import {
  type FieldStatus,
  normalizeEmail,
  normalizePhone,
  type QuoteSessionFields,
  sessionInputsKey,
} from "../quoteSession.ts";
import {
  buildVoiceGeneratedQuoteDeliveryIdentity,
  buildVoiceGeneratedQuoteFingerprint,
  VOICE_GENERATED_QUOTE_PURPOSE,
} from "./quoteDeliveryIdentity.ts";

type SB = any;

export type VoiceQuoteDeliveryReason =
  | "missing_phone"
  | "phone_not_confirmed"
  | "quote_not_firm"
  | "missing_quote_total"
  | "missing_name"
  | "missing_address"
  | "stale_quote_context"
  | "promotion_unmappable"
  | "email_unavailable"
  | "save_quote_failed"
  | "sms_not_sent"
  | "delivery_suppressed";

export interface VoiceQuoteDeliveryResult {
  ok: boolean;
  status:
    | "queued"
    | "provider_accepted"
    | "retry_pending"
    | "uncertain"
    | "suppressed"
    | "manual_follow_up"
    | "failed_terminal";
  reason?: VoiceQuoteDeliveryReason;
  quoteId?: string | null;
  attemptId?: string | null;
  providerMessageId?: string | null;
  deliveryIdentityKey?: string | null;
  quoteFingerprint?: string | null;
  /** Raw upstream status, for journaling/diagnostics only. */
  detail?: string | null;
}

export type CallEdgeFunction = (
  name: string,
  body: unknown,
) => Promise<{ status: number; json: any }>;

export interface VoiceQuoteDeliveryInput {
  supabase: SB;
  facts: ConversationFacts;
  /** Server-derived tenant authority. Mandatory on the deterministic path. */
  organizationId?: string | null;
  /** Canonical quote-session id — preferred save-quote idempotency scope. */
  quoteSessionId?: string | null;
  /** Conversation id — the idempotency scope fallback and linkage target. */
  conversationId?: string | null;
  callFunction: CallEdgeFunction;
}

function splitName(name?: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

interface SessionContext {
  readStatus: "not_requested" | "found" | "not_found" | "error";
  emailNormalized: string | null;
  customerId: string | null;
  propertyId: string | null;
  quoteId: string | null;
  updatedAt: string | null;
  fields: QuoteSessionFields | null;
  fieldStatus: Partial<Record<keyof QuoteSessionFields, FieldStatus>>;
}

async function readSessionContext(
  supabase: SB,
  quoteSessionId?: string | null,
  organizationId?: string | null,
): Promise<SessionContext> {
  const empty: SessionContext = {
    readStatus: quoteSessionId ? "not_found" : "not_requested",
    emailNormalized: null,
    customerId: null,
    propertyId: null,
    quoteId: null,
    updatedAt: null,
    fields: null,
    fieldStatus: {},
  };
  if (!quoteSessionId) return empty;
  try {
    let query = supabase
      .from("quote_sessions")
      .select(
        "email_normalized, customer_id, property_id, quote_id, fields, field_status, organization_id, updated_at",
      )
      .eq("id", quoteSessionId);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data, error } = await query.maybeSingle();
    if (error) return { ...empty, readStatus: "error" };
    if (!data) return empty;
    return {
      readStatus: "found",
      emailNormalized: normalizeEmail(data.email_normalized ?? null),
      customerId: (data.customer_id as string | null) ?? null,
      propertyId: (data.property_id as string | null) ?? null,
      quoteId: (data.quote_id as string | null) ?? null,
      updatedAt: (data.updated_at as string | null) ?? null,
      fields: (data.fields as QuoteSessionFields | null) ?? null,
      fieldStatus: (data.field_status as SessionContext["fieldStatus"]) ?? {},
    };
  } catch {
    return { ...empty, readStatus: "error" };
  }
}

interface GeneratedDeliveryAuthority {
  key: string;
  quoteFingerprint: string;
  recipientHash: string;
}

async function buildGeneratedDeliveryAuthority(
  input: VoiceQuoteDeliveryInput,
  session: SessionContext,
  recipientE164: string,
): Promise<GeneratedDeliveryAuthority | null> {
  const fields = session.fields;
  const last = fields?.lastQuoteResult;
  if (
    !fields || !last || !input.organizationId || !input.conversationId ||
    !input.quoteSessionId
  ) return null;
  const inputsKey = sessionInputsKey(fields);
  const quotedInputsKey = typeof last.inputsKey === "string"
    ? last.inputsKey
    : null;
  if (!quotedInputsKey || quotedInputsKey !== inputsKey) return null;
  const total = Number(
    last.estimatedTotal ?? fields.voiceJourney?.quoteContext?.estimatedTotal ??
      last.total ?? 0,
  );
  if (!Number.isFinite(total) || total <= 0) return null;
  const quoteFingerprint = await buildVoiceGeneratedQuoteFingerprint({
    inputsKey,
    engineVersion: typeof last.engineVersion === "string"
      ? last.engineVersion
      : fields.voiceJourney?.quoteContext?.engineVersion,
    pricingVersion: typeof last.ruleVersion === "string" ||
        typeof last.ruleVersion === "number"
      ? last.ruleVersion
      : fields.voiceJourney?.quoteContext?.pricingVersion,
    taxPolicyVersion: typeof last.taxPolicyVersion === "string"
      ? last.taxPolicyVersion
      : fields.voiceJourney?.quoteContext?.taxPolicyVersion,
    durationVersion: typeof last.durationVersion === "string"
      ? last.durationVersion
      : fields.voiceJourney?.quoteContext?.durationVersion,
    total,
    serviceSubtotal: typeof last.serviceSubtotal === "number"
      ? last.serviceSubtotal
      : fields.voiceJourney?.quoteContext?.serviceSubtotal,
    estimatedTax: typeof last.estimatedTax === "number"
      ? last.estimatedTax
      : fields.voiceJourney?.quoteContext?.estimatedTax,
    estimatedDurationMinutes: typeof last.estimatedDurationMinutes === "number"
      ? last.estimatedDurationMinutes
      : null,
    promotionId: fields.promotionId ?? null,
    discountCode: fields.discountCode?.trim().toUpperCase() ?? null,
    lineItems: Array.isArray(last.lineItems) ? last.lineItems : [],
  });
  const identity = await buildVoiceGeneratedQuoteDeliveryIdentity({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    quoteSessionId: input.quoteSessionId,
    quoteFingerprint,
    recipientE164,
  });
  return {
    key: identity.key,
    quoteFingerprint,
    recipientHash: identity.recipientHash,
  };
}

type DeliveryClaim =
  | { proceed: true }
  | { proceed: false; result: VoiceQuoteDeliveryResult };

/**
 * Reserve the exact delivery identity in the canonical quote-session JSONB
 * before save-quote or send-sms is invoked. A duplicate sees durable evidence
 * and never becomes a second provider winner.
 */
async function claimGeneratedDelivery(
  input: VoiceQuoteDeliveryInput,
  session: SessionContext,
  authority: GeneratedDeliveryAuthority,
): Promise<DeliveryClaim> {
  const prior = session.fields?.voiceJourney?.delivery;
  if (prior?.deliveryIdentityKey === authority.key) {
    const replayBase = {
      attemptId: prior.attemptId ?? null,
      providerMessageId: prior.providerMessageId ?? null,
      quoteId: session.quoteId,
      deliveryIdentityKey: authority.key,
      quoteFingerprint: authority.quoteFingerprint,
    };
    if (prior.status === "provider_accepted" || prior.status === "delivered") {
      return {
        proceed: false,
        result: {
          ok: true,
          status: "provider_accepted",
          ...replayBase,
          detail: "durable_delivery_replay",
        },
      };
    }
    if (prior.status === "pending") {
      return {
        proceed: false,
        result: {
          ok: false,
          status: "queued",
          ...replayBase,
          detail: "delivery_claim_in_progress",
        },
      };
    }
    if (
      prior.status === "queued" || prior.status === "retry_pending" ||
      prior.status === "uncertain" || prior.status === "suppressed" ||
      prior.status === "manual_follow_up" ||
      prior.status === "failed_terminal"
    ) {
      return {
        proceed: false,
        result: {
          ok: false,
          status: prior.status,
          ...replayBase,
          detail: "durable_delivery_replay",
        },
      };
    }
  }
  if (!session.fields || !session.updatedAt) {
    return {
      proceed: false,
      result: {
        ok: false,
        status: "uncertain",
        reason: "stale_quote_context",
        deliveryIdentityKey: authority.key,
        quoteFingerprint: authority.quoteFingerprint,
        detail: "delivery_claim_version_unavailable",
      },
    };
  }
  const fields: QuoteSessionFields = {
    ...session.fields,
    voiceJourney: {
      ...(session.fields.voiceJourney ?? {}),
      delivery: {
        channel: "sms",
        mode: "actual_quote",
        status: "pending",
        requestedAt: prior?.requestedAt ?? new Date().toISOString(),
        attemptId: null,
        providerMessageId: null,
        deliveryIdentityKey: authority.key,
        quoteFingerprint: authority.quoteFingerprint,
        recipientHash: authority.recipientHash,
        purpose: VOICE_GENERATED_QUOTE_PURPOSE,
      },
    },
  };
  try {
    const written = await input.supabase.from("quote_sessions").update({
      fields,
    })
      .eq("id", input.quoteSessionId)
      .eq("organization_id", input.organizationId)
      .eq("updated_at", session.updatedAt)
      .select("id").maybeSingle();
    if (written?.error || !written?.data) {
      return {
        proceed: false,
        result: {
          ok: false,
          status: "uncertain",
          reason: "stale_quote_context",
          deliveryIdentityKey: authority.key,
          quoteFingerprint: authority.quoteFingerprint,
          detail: "delivery_claim_conflict",
        },
      };
    }
    return { proceed: true };
  } catch {
    return {
      proceed: false,
      result: {
        ok: false,
        status: "uncertain",
        reason: "stale_quote_context",
        deliveryIdentityKey: authority.key,
        quoteFingerprint: authority.quoteFingerprint,
        detail: "delivery_claim_unavailable",
      },
    };
  }
}

async function deliveryClaimStillAuthoritative(
  input: VoiceQuoteDeliveryInput,
  quoteId: string,
  authority: GeneratedDeliveryAuthority,
  recipientE164: string,
): Promise<boolean> {
  const latest = await readSessionContext(
    input.supabase,
    input.quoteSessionId,
    input.organizationId,
  );
  if (
    latest.readStatus !== "found" || latest.quoteId !== quoteId ||
    !latest.customerId || !latest.propertyId ||
    latest.fields?.voiceJourney?.delivery?.deliveryIdentityKey !==
      authority.key ||
    latest.fields.voiceJourney.delivery.quoteFingerprint !==
      authority.quoteFingerprint ||
    latest.fields.voiceJourney.delivery.status !== "pending"
  ) return false;
  const current = await buildGeneratedDeliveryAuthority(
    input,
    latest,
    recipientE164,
  );
  return current?.key === authority.key &&
    current.quoteFingerprint === authority.quoteFingerprint;
}

async function finalizeGeneratedDelivery(
  input: VoiceQuoteDeliveryInput,
  authority: GeneratedDeliveryAuthority,
  result: VoiceQuoteDeliveryResult,
): Promise<boolean> {
  const latest = await readSessionContext(
    input.supabase,
    input.quoteSessionId,
    input.organizationId,
  );
  if (
    latest.readStatus !== "found" || !latest.fields || !latest.updatedAt ||
    latest.fields.voiceJourney?.delivery?.deliveryIdentityKey !== authority.key
  ) return false;
  const fields: QuoteSessionFields = {
    ...latest.fields,
    voiceJourney: {
      ...(latest.fields.voiceJourney ?? {}),
      delivery: {
        ...(latest.fields.voiceJourney?.delivery ?? {
          channel: "sms",
          mode: "actual_quote",
          requestedAt: new Date().toISOString(),
        }),
        status: result.status,
        attemptId: result.attemptId ?? null,
        providerMessageId: result.providerMessageId ?? null,
        deliveryIdentityKey: authority.key,
        quoteFingerprint: authority.quoteFingerprint,
        recipientHash: authority.recipientHash,
        purpose: VOICE_GENERATED_QUOTE_PURPOSE,
      },
    },
  };
  try {
    const written = await input.supabase.from("quote_sessions").update({
      fields,
      ...(result.quoteId ? { quote_id: result.quoteId } : {}),
    })
      .eq("id", input.quoteSessionId)
      .eq("organization_id", input.organizationId)
      .eq("updated_at", latest.updatedAt)
      .select("id").maybeSingle();
    return !written?.error && !!written?.data;
  } catch {
    return false;
  }
}

/**
 * `public.customers.email` is NOT NULL and save-quote resolves the customer by
 * email, so an email is required to persist a quote at all. It is resolved
 * DETERMINISTICALLY, in strict precedence order, from identity that is already
 * bound to this conversation:
 *
 *   1. the email the caller spoke on this call,
 *   2. `quote_sessions.email_normalized` for the canonical session,
 *   3. `chat_conversations.confirmed_email` then `prospect_email`,
 *   4. the exact linked customer row (`customers.id = customer_id`).
 *   5. exactly ONE distinct on-file email for the EXACT confirmed E.164 phone
 *      (legacy compatibility only; canonical delivery separately requires the
 *      verified quote-session email to agree).
 *
 * There is deliberately no fuzzy or partial phone search. Production contains
 * customer rows sharing a phone number with different emails, and a fuzzy
 * `ilike '%digits%'` match could hit an unrelated longer number. Step 5 is an
 * exact equality lookup and fails closed when distinct emails share the number.
 */
export async function resolveQuoteRecipientEmail(
  supabase: SB,
  facts: ConversationFacts,
  ctx: {
    quoteSessionId?: string | null;
    conversationId?: string | null;
    session?: SessionContext;
    organizationId?: string | null;
  },
): Promise<string | null> {
  const spoken = normalizeEmail(facts.contact?.email ?? null);
  if (spoken) return spoken;

  const session = ctx.session ??
    await readSessionContext(supabase, ctx.quoteSessionId ?? null);
  if (session.emailNormalized) return session.emailNormalized;

  let customerId = session.customerId;
  try {
    if (ctx.conversationId) {
      let query = supabase
        .from("chat_conversations")
        .select("confirmed_email, prospect_email, customer_id")
        .eq("id", ctx.conversationId);
      if (ctx.organizationId) {
        query = query.eq("organization_id", ctx.organizationId);
      }
      const { data } = await query.maybeSingle();
      const confirmed = normalizeEmail(data?.confirmed_email ?? null);
      if (confirmed) return confirmed;
      const prospect = normalizeEmail(data?.prospect_email ?? null);
      if (prospect) return prospect;
      if (!customerId) customerId = data?.customer_id ?? null;
    }
  } catch { /* fall through to the linked customer */ }

  if (customerId) {
    try {
      let query = supabase
        .from("customers")
        .select("email")
        .eq("id", customerId);
      if (ctx.organizationId) {
        query = query.eq("organization_id", ctx.organizationId);
      }
      const { data } = await query.maybeSingle();
      const linked = normalizeEmail(data?.email ?? null);
      if (linked) return linked;
    } catch { /* fall through to the exact-phone lookup */ }
  }

  // Exact confirmed-phone match only. Ambiguity (two distinct emails on the
  // same number) resolves to null so we never text one person's quote link to
  // another person's account.
  const phoneE164 = facts.contact?.phoneConfirmed === true
    ? normalizePhone(facts.contact?.phone ?? null)
    : null;
  if (!phoneE164) return null;
  try {
    let query = supabase
      .from("customers")
      .select("email")
      .eq("phone", phoneE164);
    if (ctx.organizationId) {
      query = query.eq("organization_id", ctx.organizationId);
    }
    const { data } = await query.limit(25);
    const distinct = new Set(
      (Array.isArray(data) ? data : [])
        .map((row: any) => normalizeEmail(row?.email ?? null))
        .filter((e: string | null): e is string => !!e),
    );
    if (distinct.size !== 1) return null;
    return [...distinct][0];
  } catch {
    return null;
  }
}

type CanonicalLineItem = { key?: string; label?: string; amount?: number };

/** Canonical engine line items → save-quote's `services` shape. The dollar
 *  figures are only a tamper check; save-quote recomputes every one of them. */
export function servicesFromFacts(
  facts: ConversationFacts,
  canonicalLineItems?: unknown[] | null,
): Array<{ name: string; amount?: number }> {
  const items = Array.isArray(canonicalLineItems)
    ? canonicalLineItems as CanonicalLineItem[]
    : Array.isArray(facts.quote?.lineItems)
    ? (facts.quote!.lineItems as CanonicalLineItem[])
    : [];
  const mapped = items
    .filter((li) => li && typeof li === "object")
    .map((li) => ({
      name: String(li.label ?? li.key ?? "").trim(),
      amount: typeof li.amount === "number" ? li.amount : undefined,
    }))
    .filter((s) => s.name.length > 0);
  if (mapped.length) return mapped;
  // Fallback only when the stored quote carries no canonical line items.
  return (facts.services ?? []).map((name) => ({ name }));
}

/** Build save-quote's payload from the canonical conversation facts, reusing
 *  the SAME facts → engine-input mapping the pricing tool uses. */
export function buildVoiceSaveQuoteBody(args: {
  facts: ConversationFacts;
  email: string;
  phoneE164: string;
  sourceSessionId: string;
  /** When present, this is the canonical pricing-input authority. */
  sessionFields?: QuoteSessionFields | null;
}): Record<string, unknown> {
  const { facts } = args;
  const p = facts.property ?? {};
  const mapped: QuoteInput = args.sessionFields
    ? quoteSessionFieldsToQuoteInput(args.sessionFields)
    : buildQuoteRequest({
      services: facts.services ?? [],
      address: facts.address,
      squareFootage: p.squareFootage,
      stories: p.stories,
      windowCleaningType: p.windowCleaningType,
      condition: p.condition,
      roofType: p.roofType,
      roofSeverity: p.roofSeverity,
      drivewaySqft: p.drivewaySqft,
      drivewaySurface: p.drivewaySurface,
      pressureWashSqft: p.pressureWashSqft,
      pressureWashSurface: p.pressureWashSurface,
      discountCode: facts.discountCode ?? undefined,
    }) as QuoteInput;
  const last = args.sessionFields?.lastQuoteResult;
  const canonicalLineItems = Array.isArray(last?.lineItems)
    ? last.lineItems
    : facts.quote?.lineItems;
  const total = Number(
    last?.estimatedTotal ?? facts.quote?.estimatedTotal ?? facts.quote?.total ??
      0,
  );
  const subtotal = Number(
    last?.serviceSubtotal ?? last?.subtotal ?? facts.quote?.serviceSubtotal ??
      total,
  );
  const { firstName, lastName } = splitName(
    args.sessionFields?.name ?? facts.contact?.name,
  );
  return {
    action: "save",
    quoteType: "one_time",
    email: args.email,
    firstName,
    lastName,
    phone: args.phoneE164,
    total,
    subtotal,
    services: servicesFromFacts(facts, canonicalLineItems),
    homeDetails: {
      ...mapped.homeDetails,
      address: args.sessionFields?.address ?? facts.address ?? null,
    },
    additionalServices: mapped.additionalServices,
    discount: mapped.discount,
    promotion: mapped.promotion,
    lineItems: canonicalLineItems ?? null,
    engineVersion: last?.engineVersion ?? facts.quote?.engineVersion ?? null,
    ruleVersion: last?.ruleVersion ?? last?.pricingVersion ??
      facts.quote?.pricingVersion ?? null,
    // Stable, non-null scope so a repeated ask in the same call updates the
    // SAME quote row instead of minting a second quote + resume token.
    sourceSessionId: args.sourceSessionId,
    attribution: { channel: "voice", source: "voice_quote_by_text" },
  };
}

/** Required local lineage gate before provider delivery. No SMS request may
 * begin until the saved quote is durably linked to its scoped session. */
async function linkSavedQuote(
  input: VoiceQuoteDeliveryInput,
  quoteId: string,
  session: SessionContext,
): Promise<boolean> {
  const { supabase } = input;
  try {
    if (
      !input.organizationId || !input.quoteSessionId ||
      !input.conversationId || !session.customerId || !session.propertyId
    ) return false;
    const quoteQuery = supabase
      .from("quotes")
      .select("id, organization_id, customer_id, property_id")
      .eq("id", quoteId)
      .eq("organization_id", input.organizationId);
    const { data: quote } = await quoteQuery.maybeSingle();
    if (!quote) return false;
    const customerId: string | null = quote?.customer_id ?? null;
    if (customerId !== session.customerId) return false;
    if (quote.property_id && quote.property_id !== session.propertyId) {
      return false;
    }
    if (session.quoteId && session.quoteId !== quoteId) return false;

    const conversation = await supabase.from("chat_conversations")
      .select("id, organization_id, quote_session_id, customer_id, property_id")
      .eq("id", input.conversationId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (
      conversation?.error || !conversation?.data ||
      conversation.data.quote_session_id !== input.quoteSessionId ||
      conversation.data.customer_id !== session.customerId ||
      conversation.data.property_id !== session.propertyId
    ) return false;

    let sessionUpdate = supabase.from("quote_sessions").update({
      quote_id: quoteId,
    }).eq("id", input.quoteSessionId)
      .eq("organization_id", input.organizationId)
      .eq("customer_id", session.customerId)
      .eq("property_id", session.propertyId);
    sessionUpdate = session.quoteId
      ? sessionUpdate.eq("quote_id", session.quoteId)
      : sessionUpdate.is("quote_id", null);
    const sessionWritten = await sessionUpdate.select("id").maybeSingle();
    if (sessionWritten?.error || !sessionWritten?.data) return false;

    // Attach the EXACT property already resolved for this session. Never
    // create or infer a property here.
    if (!quote?.property_id) {
      const quoteUpdate = supabase.from("quotes").update({
        property_id: session.propertyId,
      }).eq("id", quoteId)
        .eq("organization_id", input.organizationId)
        .eq("customer_id", session.customerId)
        .is("property_id", null);
      const quoteWritten = await quoteUpdate.select("id").maybeSingle();
      if (quoteWritten?.error || !quoteWritten?.data) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Perform a real, customer-facing voice quote-by-text delivery.
 * Returns ok:true ONLY after send-sms confirms the transactional SMS was sent.
 */
export async function deliverVoiceQuoteByText(
  input: VoiceQuoteDeliveryInput,
): Promise<VoiceQuoteDeliveryResult> {
  if (
    !input.organizationId || !input.quoteSessionId || !input.conversationId
  ) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "stale_quote_context",
      detail: "canonical_lineage_required",
    };
  }
  if (input.organizationId !== PUBLIC_BOOKING_ORGANIZATION_ID) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "stale_quote_context",
      detail: "organization_pricing_capability_unavailable",
    };
  }
  const facts = input.facts;
  const session = await readSessionContext(
    input.supabase,
    input.quoteSessionId ?? null,
    input.organizationId ?? null,
  );
  if (input.quoteSessionId && session.readStatus !== "found") {
    return {
      ok: false,
      status: session.readStatus === "error" ? "uncertain" : "failed_terminal",
      reason: "stale_quote_context",
      detail: `quote_session_${session.readStatus}`,
    };
  }
  if (
    !session.fields || !session.customerId || !session.propertyId ||
    (session.quoteId && typeof session.quoteId !== "string")
  ) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "stale_quote_context",
      detail: "canonical_identity_unresolved",
    };
  }
  const confirmed = (status: FieldStatus | undefined) =>
    status === "verified" || status === "corrected";
  if (!confirmed(session.fieldStatus.name) || !session.fields.name?.trim()) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "missing_name",
      detail: "canonical_name_unconfirmed",
    };
  }
  const canonicalEmail = normalizeEmail(session.fields.email ?? null);
  if (
    !confirmed(session.fieldStatus.email) || !canonicalEmail ||
    (session.emailNormalized && session.emailNormalized !== canonicalEmail)
  ) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "email_unavailable",
      detail: "canonical_email_unconfirmed",
    };
  }
  if (
    !confirmed(session.fieldStatus.address) ||
    !confirmed(session.fieldStatus.serviceAreaStatus)
  ) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "missing_address",
      detail: "canonical_address_unconfirmed",
    };
  }
  const factsPhone = normalizePhone(facts.contact?.phone ?? null);
  const canonicalPhone = normalizePhone(session.fields?.phone ?? null);
  if (canonicalPhone && factsPhone && canonicalPhone !== factsPhone) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "phone_not_confirmed",
    };
  }
  const phoneE164 = canonicalPhone ?? factsPhone;
  if (!phoneE164) {
    return { ok: false, status: "failed_terminal", reason: "missing_phone" };
  }
  if (facts.contact?.phoneConfirmed !== true) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "phone_not_confirmed",
    };
  }
  // A promotion changes the authoritative price. It is deliverable only when
  // the canonical session carries both the configured id and actual count;
  // spoken facts alone are not enough to reconstruct it safely.
  if (
    (session.fields?.promotionId || facts.promotionId) &&
    (!session.fields?.promotionId || session.fields.windowCount == null)
  ) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "promotion_unmappable",
    };
  }
  if (session.fields) {
    const currentInputsKey = sessionInputsKey(session.fields);
    const quotedInputsKey =
      typeof session.fields.lastQuoteResult?.inputsKey === "string"
        ? session.fields.lastQuoteResult.inputsKey
        : null;
    const journeyInputsKey =
      session.fields.voiceJourney?.quoteContext?.inputsKey ?? null;
    if (
      !quotedInputsKey || quotedInputsKey !== currentInputsKey ||
      (journeyInputsKey != null && journeyInputsKey !== currentInputsKey)
    ) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "stale_quote_context",
        quoteId: session.quoteId,
      };
    }
    const disposition = session.fields.lastQuoteResult
      ?.finalQuoteDisposition ??
      session.fields.voiceJourney?.quoteContext?.finalQuoteDisposition;
    if (disposition !== "firm") {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "quote_not_firm",
        quoteId: session.quoteId,
      };
    }
    const canonicalTotal = Number(
      session.fields.lastQuoteResult?.estimatedTotal ??
        session.fields.voiceJourney?.quoteContext?.estimatedTotal ??
        session.fields.lastQuoteResult?.total ?? 0,
    );
    if (!Number.isFinite(canonicalTotal) || canonicalTotal <= 0) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "missing_quote_total",
        quoteId: session.quoteId,
      };
    }
    if (
      !session.fields.address?.trim() ||
      session.fields.serviceAreaStatus !== "eligible"
    ) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "missing_address",
        quoteId: session.quoteId,
      };
    }
  } else {
    if (!isQuoteFirm(facts)) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "quote_not_firm",
      };
    }
    const legacyTotal = Number(
      facts.quote?.estimatedTotal ?? facts.quote?.total ?? 0,
    );
    if (!Number.isFinite(legacyTotal) || legacyTotal <= 0) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "missing_quote_total",
      };
    }
    if (
      !facts.address?.trim() || facts.serviceArea?.status !== "eligible"
    ) {
      return {
        ok: false,
        status: "failed_terminal",
        reason: "missing_address",
      };
    }
  }
  const email = await resolveQuoteRecipientEmail(
    input.supabase,
    facts,
    {
      quoteSessionId: input.quoteSessionId ?? null,
      conversationId: input.conversationId ?? null,
      session,
      organizationId: input.organizationId ?? null,
    },
  );
  if (!email || email !== canonicalEmail) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "email_unavailable",
      detail: email ? "canonical_email_conflict" : "email_unavailable",
    };
  }

  const sourceSessionId = input.quoteSessionId ?? input.conversationId ?? null;
  if (!sourceSessionId) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "save_quote_failed",
    };
  }

  const authority = await buildGeneratedDeliveryAuthority(
    input,
    session,
    phoneE164,
  );
  if (!authority) {
    return {
      ok: false,
      status: "failed_terminal",
      reason: "stale_quote_context",
      detail: "delivery_identity_unavailable",
    };
  }
  const claim = await claimGeneratedDelivery(input, session, authority);
  if (!claim.proceed) return claim.result;

  const finish = async (
    result: VoiceQuoteDeliveryResult,
  ): Promise<VoiceQuoteDeliveryResult> => {
    const complete: VoiceQuoteDeliveryResult = {
      ...result,
      deliveryIdentityKey: authority.key,
      quoteFingerprint: authority.quoteFingerprint,
    };
    if (await finalizeGeneratedDelivery(input, authority, complete)) {
      return complete;
    }
    return {
      ...complete,
      ok: false,
      status: "uncertain",
      detail: "delivery_status_persistence_uncertain",
    };
  };

  const saveBody = buildVoiceSaveQuoteBody({
    facts,
    email,
    phoneE164,
    sourceSessionId,
    sessionFields: session.fields,
  });
  let saved: { status: number; json: any };
  try {
    saved = await input.callFunction("save-quote", saveBody);
  } catch {
    // The request may have reached save-quote before the transport failed.
    // Its stable sourceSessionId makes a later manual retry idempotent, but we
    // cannot claim failure or automatically advance to SMS from this outcome.
    return await finish({
      ok: false,
      status: "uncertain",
      reason: "save_quote_failed",
      detail: "save_quote_transport_uncertain",
    });
  }
  const quoteId: string | null = saved.json?.quoteId ?? null;
  if (saved.status !== 200 || !quoteId) {
    return await finish({
      ok: false,
      status: saved.status >= 500
        ? "retry_pending"
        : saved.status >= 200 && saved.status < 300
        ? "uncertain"
        : "failed_terminal",
      reason: "save_quote_failed",
      quoteId,
      detail: String(saved.json?.status ?? saved.status),
    });
  }

  // The saved quote must be durably linked to the exact tenant, session,
  // customer, property and conversation before any provider delivery begins.
  if (!(await linkSavedQuote(input, quoteId, session))) {
    return await finish({
      ok: false,
      status: "failed_terminal",
      reason: "save_quote_failed",
      quoteId,
      detail: "saved_quote_lineage_unconfirmed",
    });
  }

  // Re-read the canonical session after quote linkage and immediately before
  // the provider boundary. A changed quote fingerprint or lineage revokes this
  // delivery identity instead of reusing stale authority.
  if (
    !await deliveryClaimStillAuthoritative(
      input,
      quoteId,
      authority,
      phoneE164,
    )
  ) {
    return await finish({
      ok: false,
      status: "failed_terminal",
      reason: "stale_quote_context",
      quoteId,
      detail: "delivery_authority_revoked_before_dispatch",
    });
  }

  let sent: { status: number; json: any };
  try {
    sent = await input.callFunction("send-sms", {
      eventType: "quote_created",
      quoteId,
      customerInitiated: true,
      voiceDeliveryKey: authority.key,
    });
  } catch {
    return await finish({
      ok: false,
      status: "uncertain",
      reason: "sms_not_sent",
      quoteId,
      detail: "send_sms_transport_uncertain",
    });
  }
  const delivered = sent.status === 200 &&
    sent.json?.transactionalSent === true &&
    sent.json?.deliveryStatus === "accepted";
  if (!delivered) {
    const upstreamStatus = String(sent.json?.deliveryStatus ?? "");
    const deliveryStatus: VoiceQuoteDeliveryResult["status"] =
      upstreamStatus === "delivery_unknown" ||
        upstreamStatus === "uncertain"
        ? "uncertain"
        : upstreamStatus === "queued"
        ? "queued"
        : upstreamStatus === "retry_pending"
        ? "retry_pending"
        : upstreamStatus === "suppressed"
        ? "suppressed"
        : upstreamStatus === "manual_follow_up"
        ? "manual_follow_up"
        : sent.status >= 500
        ? "retry_pending"
        : sent.status >= 200 && sent.status < 300 && !upstreamStatus
        ? "uncertain"
        : "failed_terminal";
    return await finish({
      ok: false,
      status: deliveryStatus,
      reason: deliveryStatus === "suppressed"
        ? "delivery_suppressed"
        : "sms_not_sent",
      quoteId,
      attemptId: typeof sent.json?.transactionalAttemptId === "string"
        ? sent.json.transactionalAttemptId
        : null,
      providerMessageId: typeof sent.json?.providerMessageId === "string"
        ? sent.json.providerMessageId
        : null,
      detail: String(
        sent.json?.transactionalError ?? sent.json?.deliveryStatus ??
          sent.status,
      ),
    });
  }
  return await finish({
    ok: true,
    status: "provider_accepted",
    quoteId,
    attemptId: typeof sent.json?.transactionalAttemptId === "string"
      ? sent.json.transactionalAttemptId
      : null,
    providerMessageId: typeof sent.json?.providerMessageId === "string"
      ? sent.json.providerMessageId
      : null,
  });
}
