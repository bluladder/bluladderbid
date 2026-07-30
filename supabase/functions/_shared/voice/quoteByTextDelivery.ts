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
//                      through the SMS outbox (`quote_delivery:sms:{quote}:{digits}`)
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
import { normalizeEmail, normalizePhone } from "../quoteSession.ts";

type SB = any;

export type VoiceQuoteDeliveryReason =
  | "missing_phone"
  | "phone_not_confirmed"
  | "quote_not_firm"
  | "missing_quote_total"
  | "missing_address"
  | "promotion_unmappable"
  | "email_unavailable"
  | "save_quote_failed"
  | "sms_not_sent";

export interface VoiceQuoteDeliveryResult {
  ok: boolean;
  reason?: VoiceQuoteDeliveryReason;
  quoteId?: string | null;
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
  emailNormalized: string | null;
  customerId: string | null;
  propertyId: string | null;
}

async function readSessionContext(
  supabase: SB,
  quoteSessionId?: string | null,
): Promise<SessionContext> {
  const empty: SessionContext = {
    emailNormalized: null,
    customerId: null,
    propertyId: null,
  };
  if (!quoteSessionId) return empty;
  try {
    const { data } = await supabase
      .from("quote_sessions")
      .select("email_normalized, customer_id, property_id")
      .eq("id", quoteSessionId)
      .maybeSingle();
    if (!data) return empty;
    return {
      emailNormalized: normalizeEmail(data.email_normalized ?? null),
      customerId: (data.customer_id as string | null) ?? null,
      propertyId: (data.property_id as string | null) ?? null,
    };
  } catch {
    return empty;
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
 *
 * There is deliberately NO phone-based search. Production contains multiple
 * customer rows sharing a phone number with DIFFERENT emails, and a fuzzy
 * `ilike '%digits%'` match could also hit an unrelated longer number — either
 * way a real quote and its resume link would be attached to the wrong person.
 * When nothing above resolves we return null and the rail truthfully tells the
 * caller nothing was sent.
 */
export async function resolveQuoteRecipientEmail(
  supabase: SB,
  facts: ConversationFacts,
  ctx: {
    quoteSessionId?: string | null;
    conversationId?: string | null;
    session?: SessionContext;
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
      const { data } = await supabase
        .from("chat_conversations")
        .select("confirmed_email, prospect_email, customer_id")
        .eq("id", ctx.conversationId)
        .maybeSingle();
      const confirmed = normalizeEmail(data?.confirmed_email ?? null);
      if (confirmed) return confirmed;
      const prospect = normalizeEmail(data?.prospect_email ?? null);
      if (prospect) return prospect;
      if (!customerId) customerId = data?.customer_id ?? null;
    }
  } catch { /* fall through to the linked customer */ }

  if (!customerId) return null;
  try {
    const { data } = await supabase
      .from("customers")
      .select("email")
      .eq("id", customerId)
      .maybeSingle();
    return normalizeEmail(data?.email ?? null);
  } catch {
    return null;
  }
}

type CanonicalLineItem = { key?: string; label?: string; amount?: number };

/** Canonical engine line items → save-quote's `services` shape. The dollar
 *  figures are only a tamper check; save-quote recomputes every one of them. */
export function servicesFromFacts(
  facts: ConversationFacts,
): Array<{ name: string; amount?: number }> {
  const items = Array.isArray(facts.quote?.lineItems)
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
}): Record<string, unknown> {
  const { facts } = args;
  const p = facts.property ?? {};
  const mapped = buildQuoteRequest({
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
  });
  const total = Number(facts.quote?.total ?? 0);
  const { firstName, lastName } = splitName(facts.contact?.name);
  return {
    action: "save",
    quoteType: "one_time",
    email: args.email,
    firstName,
    lastName,
    phone: args.phoneE164,
    total,
    subtotal: total,
    services: servicesFromFacts(facts),
    homeDetails: {
      ...mapped.homeDetails,
      address: facts.address ?? null,
    },
    additionalServices: mapped.additionalServices,
    discount: mapped.discount,
    lineItems: facts.quote?.lineItems ?? null,
    engineVersion: facts.quote?.engineVersion ?? null,
    ruleVersion: facts.quote?.pricingVersion ?? null,
    // Stable, non-null scope so a repeated ask in the same call updates the
    // SAME quote row instead of minting a second quote + resume token.
    sourceSessionId: args.sourceSessionId,
    attribution: { channel: "voice", source: "voice_quote_by_text" },
  };
}

/** Best-effort linkage after a successful save. Never fails the delivery. */
async function linkSavedQuote(
  input: VoiceQuoteDeliveryInput,
  quoteId: string,
  session: SessionContext,
): Promise<void> {
  const { supabase } = input;
  try {
    const { data: quote } = await supabase
      .from("quotes")
      .select("id, customer_id, property_id")
      .eq("id", quoteId)
      .maybeSingle();
    const customerId: string | null = quote?.customer_id ?? null;
    if (input.quoteSessionId) {
      const update: Record<string, unknown> = { quote_id: quoteId };
      if (customerId && !session.customerId) update.customer_id = customerId;
      await supabase.from("quote_sessions").update(update).eq(
        "id",
        input.quoteSessionId,
      );
    }
    if (input.conversationId && customerId) {
      await supabase.from("chat_conversations").update({
        customer_id: customerId,
      }).eq("id", input.conversationId);
    }
    // Attach the EXACT property already resolved for this session. Never
    // create or infer a property here.
    if (session.propertyId && !quote?.property_id) {
      await supabase.from("quotes").update({
        property_id: session.propertyId,
      }).eq("id", quoteId);
    }
  } catch { /* linkage is advisory; the quote and the text already exist */ }
}

/**
 * Perform a real, customer-facing voice quote-by-text delivery.
 * Returns ok:true ONLY after send-sms confirms the transactional SMS was sent.
 */
export async function deliverVoiceQuoteByText(
  input: VoiceQuoteDeliveryInput,
): Promise<VoiceQuoteDeliveryResult> {
  const facts = input.facts;
  const phoneE164 = normalizePhone(facts.contact?.phone ?? null);
  if (!phoneE164) return { ok: false, reason: "missing_phone" };
  if (facts.contact?.phoneConfirmed !== true) {
    return { ok: false, reason: "phone_not_confirmed" };
  }
  if (!isQuoteFirm(facts)) return { ok: false, reason: "quote_not_firm" };
  const total = Number(facts.quote?.total ?? 0);
  if (!isFinite(total) || total <= 0) {
    return { ok: false, reason: "missing_quote_total" };
  }
  if (
    !facts.address || !facts.address.trim() ||
    facts.serviceArea?.status !== "eligible"
  ) {
    return { ok: false, reason: "missing_address" };
  }
  // A promotion changes the authoritative price and cannot be reconstructed
  // from spoken facts (it needs the exact promo id + window count). Fail
  // closed rather than persist a quote at the wrong price.
  if (facts.promotionId) return { ok: false, reason: "promotion_unmappable" };

  const session = await readSessionContext(
    input.supabase,
    input.quoteSessionId ?? null,
  );
  const email = await resolveQuoteRecipientEmail(
    input.supabase,
    facts,
    {
      quoteSessionId: input.quoteSessionId ?? null,
      conversationId: input.conversationId ?? null,
      session,
    },
  );
  if (!email) return { ok: false, reason: "email_unavailable" };

  const sourceSessionId = input.quoteSessionId ?? input.conversationId ?? null;
  if (!sourceSessionId) return { ok: false, reason: "save_quote_failed" };

  const saveBody = buildVoiceSaveQuoteBody({
    facts,
    email,
    phoneE164,
    sourceSessionId,
  });
  const saved = await input.callFunction("save-quote", saveBody);
  const quoteId: string | null = saved.json?.quoteId ?? null;
  if (saved.status !== 200 || !quoteId) {
    return {
      ok: false,
      reason: "save_quote_failed",
      quoteId,
      detail: String(saved.json?.status ?? saved.status),
    };
  }

  const sent = await input.callFunction("send-sms", {
    eventType: "quote_created",
    quoteId,
    customerInitiated: true,
  });
  const delivered = sent.status === 200 &&
    sent.json?.transactionalSent === true &&
    sent.json?.deliveryStatus === "accepted";
  if (!delivered) {
    return {
      ok: false,
      reason: "sms_not_sent",
      quoteId,
      detail: String(
        sent.json?.transactionalError ?? sent.json?.deliveryStatus ??
          sent.status,
      ),
    };
  }
  await linkSavedQuote(input, quoteId, session);
  return { ok: true, quoteId };
}