// ============================================================================
// quoteSession.ts — Canonical Progressive Quote Session (Phase 4C-β.4)
//
// A single structured object that voice, web, SMS, and future channels edit
// incrementally. The conversation is a natural-language interface; the
// Quote Session is the authoritative record of what the customer has told us
// so far. Pure helpers (mergeFields, computeRequired, nextQuestion) are unit-
// testable without a database. Persistence is isolated in the SB helpers.
// ============================================================================

import type { ConversationFacts } from "./conversationState.ts";
import { quoteInputsKey } from "./conversationState.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export type QuoteSessionChannel = "voice" | "web" | "sms" | "chat";
export type FieldStatus = "unknown" | "captured" | "verified" | "corrected" | "derived";

export interface QuoteSessionFields {
  services?: string[];
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  squareFootage?: number;
  stories?: number;
  windowCleaningType?: string;
  condition?: string;
  roofType?: string;
  roofSeverity?: string;
  drivewaySqft?: number;
  drivewaySurface?: string;
  pressureWashSqft?: number;
  pressureWashSurface?: string;
  promotionId?: string | null;
  discountCode?: string | null;
  // Phase 4C-β.4A — window-scope classification
  customerType?: "residential" | "commercial" | "unknown";
  windowCleaningScope?: "whole_home" | "partial" | "commercial_custom" | "unknown";
  windowCleaningSides?: "outside_only" | "inside_and_outside";
  windowCount?: number;
  partialAreas?: string[];
  partialAccessNotes?: string;
  partialWindowPrice?: number;
  partialWindowRuleVersion?: string;
  commercialPropertyType?: string;
  commercialLocations?: Array<{
    address?: string;
    propertyType?: string;
    windowsEstimate?: number;
    stories?: number;
    sides?: "outside_only" | "inside_and_outside";
    frequency?: string;
    accessNotes?: string;
    notes?: string;
  }>;
  commercialFrequency?: string;
  commercialScopeNotes?: string;
  preferredContactMethods?: Array<"text" | "email" | "phone">;
  humanPricingRequired?: boolean;
  bidRequestStatus?:
    | "commercial_bid_requested"
    | "human_pricing_required"
    | "scope_collection_complete"
    | "awaiting_ben_review";
  // ---- Workflow controller rollout state (Phase 4C-β.6) ----
  // Persisted opaquely on quote_sessions.fields. Never exposed to the caller.
  callerIdConfirmationStatus?: "pending" | "confirmed" | "declined";
  callerIdProposedE164?: string;
  returningCustomerId?: string;
  returningCustomerResolved?: boolean;
  awaitingDisambiguator?: boolean;
}

export interface QuoteSession {
  id: string;
  channel: QuoteSessionChannel;
  conversationIds: string[];
  customerId?: string | null;
  quoteId?: string | null;
  fields: QuoteSessionFields;
  fieldStatus: Partial<Record<keyof QuoteSessionFields, FieldStatus>>;
  requiredRemaining: string[];
  lastStep?: string | null;
  quoteStatus: "none" | "estimated" | "firm" | "manual_review" | "error";
  bookingReady: boolean;
  phoneE164?: string | null;
  emailNormalized?: string | null;
}

/** Merge a patch of fields; track status transitions.
 *  unknown -> captured (first non-empty value)
 *  captured -> corrected (value changed after capture)
 *  markVerified/markDerived override to those statuses. */
export function mergeFields(
  prev: QuoteSession,
  patch: Partial<QuoteSessionFields>,
  opts: { markVerified?: (keyof QuoteSessionFields)[]; markDerived?: (keyof QuoteSessionFields)[] } = {},
): QuoteSession {
  const nextFields: QuoteSessionFields = { ...prev.fields };
  const nextStatus = { ...prev.fieldStatus };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const key = k as keyof QuoteSessionFields;
    const prevVal = (prev.fields as Record<string, unknown>)[key];
    const isEmpty = v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (isEmpty) continue;
    (nextFields as Record<string, unknown>)[key] = v;
    const wasCaptured = nextStatus[key] === "captured" || nextStatus[key] === "verified";
    const changed = prevVal !== undefined && JSON.stringify(prevVal) !== JSON.stringify(v);
    nextStatus[key] = wasCaptured && changed ? "corrected" : "captured";
  }
  for (const k of opts.markVerified ?? []) nextStatus[k] = "verified";
  for (const k of opts.markDerived ?? []) nextStatus[k] = "derived";
  return { ...prev, fields: nextFields, fieldStatus: nextStatus };
}

// Fields whose validity depends on WHOLE-HOME pricing (sqft-based engine).
// A scope flip whole_home ↔ partial must invalidate ONLY these; address,
// contact, notes, and conversation history are preserved.
const WHOLE_HOME_PRICING_FIELDS: (keyof QuoteSessionFields)[] = [
  "squareFootage",
  "windowCleaningType",
];
const PARTIAL_PRICING_FIELDS: (keyof QuoteSessionFields)[] = [
  "windowCount",
  "partialAreas",
  "partialAccessNotes",
  "partialWindowPrice",
  "partialWindowRuleVersion",
];

/** Apply a scope change while preserving unrelated captured facts. Invalidates
 *  ONLY the fields whose meaning depends on the previous scope's pricing. */
export function changeWindowScope(
  prev: QuoteSession,
  nextScope: NonNullable<QuoteSessionFields["windowCleaningScope"]>,
): QuoteSession {
  const currentScope = prev.fields.windowCleaningScope;
  if (currentScope === nextScope) return prev;
  const nextFields: QuoteSessionFields = { ...prev.fields };
  const nextStatus = { ...prev.fieldStatus };
  const invalidate = (keys: (keyof QuoteSessionFields)[]) => {
    for (const k of keys) {
      delete (nextFields as Record<string, unknown>)[k];
      delete nextStatus[k];
    }
  };
  if (currentScope === "whole_home" && nextScope === "partial") invalidate(WHOLE_HOME_PRICING_FIELDS);
  if (currentScope === "partial" && nextScope === "whole_home") invalidate(PARTIAL_PRICING_FIELDS);
  nextFields.windowCleaningScope = nextScope;
  nextStatus.windowCleaningScope = "captured";
  return { ...prev, fields: nextFields, fieldStatus: nextStatus };
}

/** Merge one commercial location into the array without flattening existing
 *  locations to a note. Locations are matched by normalized address. */
export function addCommercialLocation(
  prev: QuoteSession,
  loc: NonNullable<QuoteSessionFields["commercialLocations"]>[number],
): QuoteSession {
  const list = [...(prev.fields.commercialLocations ?? [])];
  const norm = (s?: string) => (s ?? "").trim().toLowerCase();
  const idx = list.findIndex((x) => norm(x.address) && norm(x.address) === norm(loc.address));
  if (idx >= 0) list[idx] = { ...list[idx], ...loc };
  else list.push(loc);
  return mergeFields(prev, { commercialLocations: list });
}

function needsStories(service: string): boolean {
  return service === "windowCleaning" || service === "houseWash" || service === "gutters" || service === "roofCleaning";
}

/** Which fields are still required for canonical pricing of the CURRENT
 *  selected services. Mirrors the pricing engine's declared inputs; does NOT
 *  introduce new pricing rules. */
export function computeRequired(fields: QuoteSessionFields): string[] {
  const missing: string[] = [];
  const services = fields.services ?? [];
  if (services.length === 0) return ["services"];
  // Commercial custom-bid requests never need residential pricing inputs.
  if (fields.windowCleaningScope === "commercial_custom" || fields.customerType === "commercial") {
    if (!fields.commercialLocations || fields.commercialLocations.length === 0) missing.push("commercialLocations");
    if (!fields.preferredContactMethods || fields.preferredContactMethods.length === 0) missing.push("preferredContactMethods");
    return missing;
  }
  // Partial-window requests need only per-window inputs, never sqft.
  if (fields.windowCleaningScope === "partial") {
    if (fields.windowCount == null) missing.push("windowCount");
    if (!fields.windowCleaningSides) missing.push("windowCleaningSides");
    return missing;
  }
  // Whole-home / default residential path — unchanged canonical inputs.
  if (fields.squareFootage == null) missing.push("squareFootage");
  if (fields.stories == null && services.some((s) => needsStories(s))) missing.push("stories");
  if (services.includes("windowCleaning") && !fields.windowCleaningType && !fields.windowCleaningSides) {
    missing.push("windowCleaningType");
  }
  if (services.includes("driveway") && fields.drivewaySqft == null) missing.push("drivewaySqft");
  if (services.includes("pressureWashing") && fields.pressureWashSqft == null) missing.push("pressureWashSqft");
  return missing;
}

export function isReadyToPrice(fields: QuoteSessionFields): boolean {
  return computeRequired(fields).length === 0;
}

export function isReadyToBook(session: QuoteSession): boolean {
  const f = session.fields;
  return (
    (session.quoteStatus === "firm" || session.quoteStatus === "estimated") &&
    !!f.address &&
    !!f.email
  );
}

const QUESTION_PRIORITY: string[] = [
  "services",
  "windowCleaningScope",
  "windowCount",
  "windowCleaningSides",
  "commercialLocations",
  "preferredContactMethods",
  "squareFootage",
  "windowCleaningType",
  "stories",
  "drivewaySqft",
  "pressureWashSqft",
  "city",
  "address",
  "name",
  "email",
  "phone",
];

export interface NextQuestionPlan {
  readyToPrice: boolean;
  readyToBook: boolean;
  missing: string[];
  nextField: string | null;
}

export function nextQuestion(session: QuoteSession): NextQuestionPlan {
  const missing = computeRequired(session.fields);
  const readyToPrice = missing.length === 0;
  const readyToBook = isReadyToBook(session);
  let nextField: string | null = null;
  for (const key of QUESTION_PRIORITY) {
    if (missing.includes(key)) {
      nextField = key;
      break;
    }
  }
  return { readyToPrice, readyToBook, missing, nextField };
}

export function fieldsFromFacts(facts: ConversationFacts): QuoteSessionFields {
  const p = facts.property ?? {};
  const c = facts.contact ?? {};
  return {
    services: facts.services,
    name: c.name,
    email: c.email,
    phone: c.phone,
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
    promotionId: facts.promotionId ?? null,
    discountCode: facts.discountCode ?? null,
    city: facts.roughQuote?.city,
  };
}

export function quoteStatusFromFacts(facts: ConversationFacts): QuoteSession["quoteStatus"] {
  const s = facts.quote?.status;
  if (s === "firm") return "firm";
  if (s === "estimated") return "estimated";
  if (s === "manual_review_required") return "manual_review";
  if (s === "error" || s === "pricing_unavailable") return "error";
  return "none";
}

const EMPTY_SESSION = (channel: QuoteSessionChannel, id: string): QuoteSession => ({
  id,
  channel,
  conversationIds: [],
  fields: {},
  fieldStatus: {},
  requiredRemaining: [],
  quoteStatus: "none",
  bookingReady: false,
});

function rowToSession(row: Record<string, unknown>): QuoteSession {
  return {
    id: row.id as string,
    channel: row.channel as QuoteSessionChannel,
    conversationIds: (row.conversation_ids as string[]) ?? [],
    customerId: (row.customer_id as string | null) ?? null,
    quoteId: (row.quote_id as string | null) ?? null,
    fields: (row.fields as QuoteSessionFields) ?? {},
    fieldStatus: (row.field_status as QuoteSession["fieldStatus"]) ?? {},
    requiredRemaining: (row.required_remaining as string[]) ?? [],
    lastStep: (row.last_step as string | null) ?? null,
    quoteStatus: (row.quote_status as QuoteSession["quoteStatus"]) ?? "none",
    bookingReady: !!row.booking_ready,
    phoneE164: (row.phone_e164 as string | null) ?? null,
    emailNormalized: (row.email_normalized as string | null) ?? null,
  };
}

export function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  return email.trim().toLowerCase() || null;
}
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

/** Find an existing session for this conversation, or a matching one across
 *  channels by verified phone/email; otherwise create. */
export async function findOrCreateForConversation(
  supabase: SB,
  args: {
    conversationId: string;
    channel: QuoteSessionChannel;
    phone?: string | null;
    email?: string | null;
  },
): Promise<QuoteSession> {
  const { conversationId, channel } = args;

  const conv = await supabase
    .from("chat_conversations")
    .select("id, quote_session_id")
    .eq("id", conversationId)
    .maybeSingle();
  const existingId: string | null = conv?.data?.quote_session_id ?? null;
  if (existingId) {
    const { data } = await supabase.from("quote_sessions").select("*").eq("id", existingId).maybeSingle();
    if (data) return rowToSession(data);
  }

  const phoneE164 = normalizePhone(args.phone);
  const emailNormalized = normalizeEmail(args.email);
  if (phoneE164 || emailNormalized) {
    let q = supabase.from("quote_sessions").select("*").order("updated_at", { ascending: false }).limit(1);
    if (phoneE164) q = q.eq("phone_e164", phoneE164);
    else if (emailNormalized) q = q.eq("email_normalized", emailNormalized);
    const { data } = await q.maybeSingle();
    if (data) {
      const session = rowToSession(data);
      const nextIds = Array.from(new Set([...(session.conversationIds ?? []), conversationId]));
      await supabase.from("quote_sessions").update({ conversation_ids: nextIds }).eq("id", session.id);
      await supabase.from("chat_conversations").update({ quote_session_id: session.id }).eq("id", conversationId);
      return { ...session, conversationIds: nextIds };
    }
  }

  const insert = {
    channel,
    conversation_ids: [conversationId],
    phone_e164: phoneE164,
    email_normalized: emailNormalized,
  } as Record<string, unknown>;
  const { data: created } = await supabase
    .from("quote_sessions")
    .insert(insert)
    .select("*")
    .single();
  if (created) {
    await supabase.from("chat_conversations").update({ quote_session_id: created.id }).eq("id", conversationId);
    return rowToSession(created);
  }
  return EMPTY_SESSION(channel, conversationId);
}

/**
 * Strict read-only lookup: returns the QuoteSession bound to the given
 * conversation, or null. Never inserts, never updates, never links a session
 * across conversations. Callers that must remain read-only (e.g. the booking
 * readiness tool) MUST use this instead of findOrCreateForConversation.
 */
export async function findByConversation(
  supabase: SB,
  conversationId: string,
): Promise<QuoteSession | null> {
  if (!conversationId) return null;
  try {
    const { data: conv } = await supabase
      .from("chat_conversations")
      .select("quote_session_id")
      .eq("id", conversationId)
      .maybeSingle();
    const sid: string | null = conv?.quote_session_id ?? null;
    if (!sid) return null;
    const { data } = await supabase
      .from("quote_sessions")
      .select("*")
      .eq("id", sid)
      .maybeSingle();
    return data ? rowToSession(data) : null;
  } catch {
    return null;
  }
}

/** Sync a session from the orchestrator's current ConversationFacts. Primary
 *  write path: every persistFacts() call also mirrors here so voice/web/SMS
 *  edit the same canonical object. */
export async function syncFromFacts(
  supabase: SB,
  sessionId: string,
  facts: ConversationFacts,
): Promise<void> {
  if (!sessionId) return;
  const { data: row } = await supabase.from("quote_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!row) return;
  const prev = rowToSession(row);
  const patch = fieldsFromFacts(facts);
  const merged = mergeFields(prev, patch);
  const required = computeRequired(merged.fields);
  const quoteStatus = quoteStatusFromFacts(facts);
  const bookingReady = isReadyToBook({ ...merged, quoteStatus });
  const update: Record<string, unknown> = {
    fields: merged.fields,
    field_status: merged.fieldStatus,
    required_remaining: required,
    quote_status: quoteStatus,
    booking_ready: bookingReady,
    last_step: facts.quote?.inputsKey ? "quoted" : (facts.services?.length ? "identifying_need" : "new"),
  };
  const phone = normalizePhone(facts.contact?.phone);
  const email = normalizeEmail(facts.contact?.email);
  if (phone) update.phone_e164 = phone;
  if (email) update.email_normalized = email;
  await supabase.from("quote_sessions").update(update).eq("id", sessionId);
}

export const inputsKey = quoteInputsKey;
