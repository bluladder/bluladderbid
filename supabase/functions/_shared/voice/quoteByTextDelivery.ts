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
import { buildQuoteRequest } from "../aiTools.ts";
import { normalizeEmail, normalizePhone } from "../quoteSession.ts";

type SB = any;

export type VoiceQuoteDeliveryReason =
  | "missing_phone"
  | "missing_quote_total"
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
  /** Canonical quote-session id — used as save-quote's idempotency scope. */
  sessionId?: string | null;
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

/**
 * A voice caller rarely spells out an email, but `public.customers.email` is
 * NOT NULL and save-quote resolves the customer by email. So: use the email the
 * caller gave, otherwise reuse the email already on file for this confirmed
 * phone number. Never fabricate a placeholder address.
 *
 * AMBIGUITY IS FATAL, NOT A TIEBREAK. Production really does contain more than
 * one customer row sharing a phone number with DIFFERENT emails. Guessing would
 * attach a real quote — and its resume link — to the wrong customer record, so
 * when the confirmed phone maps to more than one distinct email we return null
 * and the rail truthfully tells the caller nothing was sent.
 */
export async function resolveQuoteRecipientEmail(
  supabase: SB,
  facts: ConversationFacts,
  phoneE164: string,
): Promise<string | null> {
  const spoken = normalizeEmail(facts.contact?.email ?? null);
  if (spoken) return spoken;
  const digits = phoneE164.replace(/\D/g, "").slice(-10);
  if (digits.length !== 10) return null;
  try {
    const { data } = await supabase
      .from("customers")
      .select("email, phone, updated_at")
      .not("email", "is", null)
      .ilike("phone", `%${digits}%`)
      .order("updated_at", { ascending: false })
      .limit(20);
    const rows: Array<{ email?: string | null; phone?: string | null }> =
      Array.isArray(data) ? data : [];
    // `ilike '%digits%'` can also match a longer number that merely contains
    // these digits, so require an exact last-10 match before trusting a row.
    const candidates = new Set<string>();
    for (const row of rows) {
      const rowDigits = String(row?.phone ?? "").replace(/\D/g, "").slice(-10);
      if (rowDigits !== digits) continue;
      const email = normalizeEmail(row?.email ?? null);
      if (email) candidates.add(email);
    }
    if (candidates.size !== 1) return null;
    return [...candidates][0];
  } catch {
    return null;
  }
}

/** Build save-quote's payload from the canonical conversation facts, reusing
 *  the SAME facts → engine-input mapping the pricing tool uses. */
export function buildVoiceSaveQuoteBody(args: {
  facts: ConversationFacts;
  email: string;
  phoneE164: string;
  sessionId?: string | null;
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
    // Length-only gate in save-quote; every dollar figure is recomputed there.
    services: (facts.services ?? []).map((name) => ({ name })),
    homeDetails: {
      ...mapped.homeDetails,
      address: facts.address ?? null,
    },
    additionalServices: mapped.additionalServices,
    discount: mapped.discount,
    sourceSessionId: args.sessionId ?? null,
    attribution: { channel: "voice", source: "voice_quote_by_text" },
  };
}

/**
 * Perform a real, customer-facing voice quote-by-text delivery.
 * Returns ok:true ONLY after send-sms confirms the transactional SMS was sent.
 */
export async function deliverVoiceQuoteByText(
  input: VoiceQuoteDeliveryInput,
): Promise<VoiceQuoteDeliveryResult> {
  const phoneE164 = normalizePhone(input.facts.contact?.phone ?? null);
  if (!phoneE164) return { ok: false, reason: "missing_phone" };
  const total = Number(input.facts.quote?.total ?? 0);
  if (!isFinite(total) || total <= 0) {
    return { ok: false, reason: "missing_quote_total" };
  }

  const email = await resolveQuoteRecipientEmail(
    input.supabase,
    input.facts,
    phoneE164,
  );
  if (!email) return { ok: false, reason: "email_unavailable" };

  const saveBody = buildVoiceSaveQuoteBody({
    facts: input.facts,
    email,
    phoneE164,
    sessionId: input.sessionId ?? null,
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
    sent.json?.transactionalSent === true;
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
  return { ok: true, quoteId };
}