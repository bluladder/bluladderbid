// ============================================================================
// Privacy-safe, idempotent post-call operational notes.
//
// The note is a read-only snapshot of canonical conversation/quote-session
// state. It never summarizes a provider transcript, never stores a raw provider
// identifier, and never calls Jobber or another provider. A deterministic
// chat_messages primary key makes repeated final provider events converge on
// one local note.
// ============================================================================

import type { ConversationFacts } from "../conversationState.ts";
import { deterministicUuid } from "../deterministicUuid.ts";
import type { QuoteSessionFields } from "../quoteSession.ts";
import { extractCallEndContext } from "./hangupBidLinkFollowup.ts";
import { sanitizeTurnContent } from "./turnJournal.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export const POST_CALL_NOTE_VERSION = "voice-post-call-v1";
export const POST_CALL_NOTE_MAX_CHARS = 1200;
export const POST_CALL_SPECIAL_REQUEST_MAX_CHARS = 160;
export const POST_CALL_SPECIAL_REQUEST_MAX_COUNT = 3;

export type PostCallNoteStatus =
  | "persisted"
  | "duplicate"
  | "ignored"
  | "error";

export interface PostCallOperationalSnapshot {
  callerReason:
    | "new_quote"
    | "schedule"
    | "existing_quote"
    | "reschedule"
    | "cancel"
    | "question_or_memo"
    | "not_recorded";
  services: string[];
  quoteOutcome:
    | "firm"
    | "estimated"
    | "manual_review"
    | "error"
    | "none";
  authoritativeTotal: number | null;
  requestedAction: string;
  addressStatus: string;
  specialRequests: string[];
  unresolvedItem: string | null;
  providerMemoStatus: "disabled";
}

export interface PostCallOperationalNoteResult {
  status: PostCallNoteStatus;
  conversationId: string | null;
  quoteSessionId: string | null;
  noteId: string | null;
  providerMemoStatus: "disabled";
  reason?:
    | "missing_call_identity"
    | "conversation_authority_mismatch"
    | "quote_session_authority_mismatch"
    | "note_write_failed";
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function finiteMoney(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : fallback;
}

/**
 * Free text is restricted to already-captured operational requests and is
 * sanitized again at the persistence boundary. Contact details, addresses,
 * UUIDs, and provider-shaped identifiers are not useful in this summary.
 */
export function sanitizePostCallSpecialRequest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let out = sanitizeTurnContent(value);
  out = out
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted contact]")
    .replace(/(?:\+?1[\s().-]*)?(?:\d[\s().-]*){10}\b/g, "[redacted contact]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted identifier]",
    )
    .replace(
      /\b(?:provider|call|message|request)[ _-]?id\s*[:=#-]?\s*[A-Za-z0-9_-]{6,}\b/gi,
      "[redacted identifier]",
    )
    .replace(
      /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,48}\s(?:street|st|road|rd|lane|ln|drive|dr|avenue|ave|boulevard|blvd|court|ct|circle|cir|parkway|pkwy)\b/gi,
      "[redacted address]",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!out) return null;
  return out.length > POST_CALL_SPECIAL_REQUEST_MAX_CHARS
    ? `${out.slice(0, POST_CALL_SPECIAL_REQUEST_MAX_CHARS - 1)}…`
    : out;
}

function normalizeServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.flatMap((item) => {
      if (typeof item !== "string") return [];
      const normalized = item.trim().toLowerCase();
      return /^[a-z0-9_-]{1,48}$/.test(normalized) ? [normalized] : [];
    })),
  ].sort().slice(0, 12);
}

function requestedAction(
  facts: ConversationFacts,
  fields: QuoteSessionFields,
): string {
  const journey = fields.voiceJourney;
  const booking = journey?.booking?.status;
  if (booking === "confirmed") return "booking_confirmed";
  if (booking === "recovery_pending") return "booking_recovery_pending";
  if (booking === "failed") return "booking_failed_manual_follow_up";
  const delivery = journey?.delivery?.status;
  if (delivery && delivery !== "not_requested") {
    return `quote_delivery_${delivery}`;
  }
  if (facts.callbackRequested) return "callback_requested";
  if (journey?.requestedNextStep === "schedule") {
    const availability = journey.availability?.status ?? "not_requested";
    return `scheduling_${availability}`;
  }
  if (journey?.requestedNextStep === "text_quote") {
    return "generated_quote_requested";
  }
  return "none";
}

function unresolvedItem(
  facts: ConversationFacts,
  fields: QuoteSessionFields,
  quoteOutcome: PostCallOperationalSnapshot["quoteOutcome"],
): string | null {
  const disposition = fields.voiceJourney?.quoteContext?.finalQuoteDisposition;
  if (
    fields.humanPricingRequired ||
    fields.bidRequestStatus === "awaiting_ben_review"
  ) {
    return "human_pricing_review";
  }
  if (
    quoteOutcome === "manual_review" || disposition === "manual_review" ||
    disposition === "owner_decision_required" || facts.manualReviewReason
  ) {
    return "manual_quote_review";
  }
  const delivery = fields.voiceJourney?.delivery?.status;
  if (
    delivery === "uncertain" || delivery === "retry_pending" ||
    delivery === "manual_follow_up" || delivery === "failed_terminal"
  ) {
    return `quote_delivery_${delivery}`;
  }
  const booking = fields.voiceJourney?.booking?.status;
  if (booking === "recovery_pending" || booking === "failed") {
    return `booking_${booking}`;
  }
  return null;
}

export function buildPostCallOperationalSnapshot(args: {
  facts: ConversationFacts;
  fields: QuoteSessionFields;
  quoteStatus: unknown;
}): PostCallOperationalSnapshot {
  const journey = args.fields.voiceJourney;
  const callerReason = enumValue(
    journey?.intent,
    [
      "new_quote",
      "schedule",
      "existing_quote",
      "reschedule",
      "cancel",
      "question_or_memo",
      "not_recorded",
    ] as const,
    "not_recorded",
  );
  const quoteOutcome = enumValue(
    args.quoteStatus,
    [
      "firm",
      "estimated",
      "manual_review",
      "error",
      "none",
    ] as const,
    "none",
  );
  const total = quoteOutcome === "firm" || quoteOutcome === "estimated"
    ? finiteMoney(journey?.quoteContext?.estimatedTotal)
    : null;
  const rawNotes = journey?.volunteeredNotes ?? [];
  const specialRequests = rawNotes
    .map(sanitizePostCallSpecialRequest)
    .filter((note): note is string => !!note)
    .slice(-POST_CALL_SPECIAL_REQUEST_MAX_COUNT);
  const addressStatus = enumValue(
    args.fields.serviceAreaStatus ?? args.facts.serviceArea?.status,
    [
      "eligible",
      "pending_confirmation",
      "manual_review_required",
      "ineligible",
      "ambiguous",
      "unavailable",
      "address_incomplete",
      "validation_unavailable",
      "not_collected",
    ] as const,
    "not_collected",
  );
  return {
    callerReason,
    services: normalizeServices(args.fields.services ?? args.facts.services),
    quoteOutcome,
    authoritativeTotal: total,
    requestedAction: requestedAction(args.facts, args.fields),
    addressStatus,
    specialRequests,
    unresolvedItem: unresolvedItem(args.facts, args.fields, quoteOutcome),
    providerMemoStatus: "disabled",
  };
}

function readable(value: string): string {
  return value.replaceAll("_", " ");
}

export function renderPostCallOperationalNote(
  summary: PostCallOperationalSnapshot,
): string {
  const parts = [
    `Caller reason: ${readable(summary.callerReason)}.`,
    `Requested services: ${
      summary.services.length
        ? summary.services.map(readable).join(", ")
        : "not recorded"
    }.`,
    `Authoritative quote outcome: ${readable(summary.quoteOutcome)}${
      summary.authoritativeTotal === null
        ? ""
        : `, $${summary.authoritativeTotal.toFixed(2)}`
    }.`,
    `Requested follow-up: ${readable(summary.requestedAction)}.`,
    `Address status: ${readable(summary.addressStatus)}.`,
  ];
  if (summary.specialRequests.length) {
    parts.push(`Special requests: ${summary.specialRequests.join(" | ")}.`);
  }
  if (summary.unresolvedItem) {
    parts.push(`Unresolved item: ${readable(summary.unresolvedItem)}.`);
  }
  parts.push("Provider memo: disabled; local operational note only.");
  const content = parts.join("\n");
  return content.length > POST_CALL_NOTE_MAX_CHARS
    ? `${content.slice(0, POST_CALL_NOTE_MAX_CHARS - 1)}…`
    : content;
}

export async function persistPostCallOperationalNote(
  supabase: SB,
  args: { body: unknown; organizationId: string },
): Promise<PostCallOperationalNoteResult> {
  const base = {
    conversationId: null,
    quoteSessionId: null,
    noteId: null,
    providerMemoStatus: "disabled" as const,
  };
  const callId = extractCallEndContext(args.body).callId;
  if (!callId) {
    return { ...base, status: "ignored", reason: "missing_call_identity" };
  }
  try {
    const conversation = await supabase.from("chat_conversations")
      .select("id, organization_id, quote_session_id, facts, booking_status")
      .eq("session_token", `vapi_call:${callId}`)
      .eq("channel", "voice")
      .eq("organization_id", args.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversation?.error || !conversation?.data) {
      return {
        ...base,
        status: "error",
        reason: "conversation_authority_mismatch",
      };
    }
    const conversationId = String(conversation.data.id);
    const quoteSessionId =
      typeof conversation.data.quote_session_id === "string"
        ? conversation.data.quote_session_id
        : null;
    const facts = object(conversation.data.facts) as ConversationFacts;
    let fields: QuoteSessionFields = {};
    let quoteStatus: unknown = facts.quote?.status ?? "none";
    if (quoteSessionId) {
      const session = await supabase.from("quote_sessions")
        .select("id, organization_id, fields, quote_status")
        .eq("id", quoteSessionId)
        .eq("organization_id", args.organizationId)
        .maybeSingle();
      if (session?.error || !session?.data) {
        return {
          status: "error",
          conversationId,
          quoteSessionId,
          noteId: null,
          providerMemoStatus: "disabled",
          reason: "quote_session_authority_mismatch",
        };
      }
      fields = object(session.data.fields) as QuoteSessionFields;
      quoteStatus = session.data.quote_status;
    }
    const summary = buildPostCallOperationalSnapshot({
      facts: {
        ...facts,
        bookingStatus: facts.bookingStatus ?? conversation.data.booking_status,
      },
      fields,
      quoteStatus,
    });
    const noteId = await deterministicUuid(
      "voice-post-call-operational-note",
      args.organizationId,
      conversationId,
      callId,
      POST_CALL_NOTE_VERSION,
    );
    const row = {
      id: noteId,
      conversation_id: conversationId,
      role: "system",
      content: renderPostCallOperationalNote(summary),
      ai_metadata: {
        channel: "voice",
        source: "post_call_operational_note",
        note_version: POST_CALL_NOTE_VERSION,
        note_identity: noteId,
        organization_id: args.organizationId,
        quote_session_id: quoteSessionId,
        operational_summary: summary,
        local_note_status: "persisted",
        provider_memo_status: "disabled",
        pricing_authority: false,
        address_authority: false,
        booking_authority: false,
      },
    };
    const inserted = await supabase.from("chat_messages").insert(row);
    if (!inserted?.error) {
      return {
        status: "persisted",
        conversationId,
        quoteSessionId,
        noteId,
        providerMemoStatus: "disabled",
      };
    }
    const winner = await supabase.from("chat_messages")
      .select("id, conversation_id, ai_metadata")
      .eq("id", noteId)
      .eq("conversation_id", conversationId)
      .contains("ai_metadata", { note_identity: noteId })
      .maybeSingle();
    if (!winner?.error && winner?.data) {
      return {
        status: "duplicate",
        conversationId,
        quoteSessionId,
        noteId,
        providerMemoStatus: "disabled",
      };
    }
    return {
      status: "error",
      conversationId,
      quoteSessionId,
      noteId,
      providerMemoStatus: "disabled",
      reason: "note_write_failed",
    };
  } catch {
    return { ...base, status: "error", reason: "note_write_failed" };
  }
}
