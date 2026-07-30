// ============================================================================
// hangupBidLinkFollowup — post-hangup online-bid SMS fallback.
//
// Trigger: the AUTHORITATIVE final Vapi call-ended event ("end-of-call-report")
// received by voice-vapi-events. Never during an active call, never from
// status-update / hang / diagnostics traffic.
//
// Behavior: when an inbound customer call ends WITHOUT an accepted
// quote-by-text delivery and WITHOUT a completed booking, send exactly one
// short transactional follow-up containing the canonical online bid link.
//
// Delivery path: the durable SMS outbox (`sendOutboxSms`), which reserves the
// `sms_messages` row on `outbound_idempotency_key` BEFORE the provider call and
// finalizes it after. Opt-out, per-lead pause and system-test/suppression are
// enforced here immediately before enqueue, exactly as `send-sms` does for its
// event lane. This module performs NO direct CallRail/provider request and
// contains no second SMS subsystem.
//
// Why not call the `send-sms` function itself: its event lane requires a
// bookingId/quoteId (there is neither — the caller hung up before a quote was
// persisted) and its free-text lane requires an operations-admin JWT, which a
// provider webhook does not have. Both would have required changing `send-sms`.
// The shared outbox helper below is the same authoritative delivery mechanism
// `send-sms` itself uses.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { getAppUrl } from "../appUrl.ts";
import { normalizePhoneE164 } from "../suppression.ts";
import { checkSuppression } from "../suppression.ts";
import { checkPhoneOptOut, getCustomerPause } from "../sms.ts";
import { sendOutboxSms } from "../smsOutbox.ts";
import type { ConversationFacts } from "../conversationState.ts";

type SB = any;

export const VOICE_HANGUP_BID_LINK_MESSAGE_KIND = "voice_call_bid_link";

/** The single authoritative final call-ended event. */
export const FINAL_CALL_ENDED_EVENT = "end-of-call-report";

export type HangupFollowupStatus =
  | "not_final_event"
  | "sent"
  | "duplicate"
  | "suppressed"
  | "opted_out"
  | "paused"
  | "missing_phone"
  | "no_customer_interaction"
  | "already_delivered"
  | "already_booked"
  | "declined_texting"
  | "failed";

export interface HangupFollowupResult {
  status: HangupFollowupStatus;
  /** Non-PII detail for structured logging. */
  detail?: string | null;
  smsMessageId?: string | null;
}

export function isFinalCallEndedEvent(eventType: string | null): boolean {
  return eventType === FINAL_CALL_ENDED_EVENT;
}

/** Canonical public online bid entry point. Never a hardcoded duplicate. */
export function canonicalOnlineBidUrl(): string {
  return getAppUrl();
}

export function buildBidLinkMessage(link: string): string {
  return `Thanks for calling BluLadder. You can finish your quote online here: ${link}`;
}

/** Durable idempotency key scoped to the call plus destination. */
export function buildBidLinkOutboundKey(
  callId: string,
  phoneE164: string,
): string {
  return `voice_call_bid_link:${callId}:${
    phoneE164.replace(/\D/g, "").slice(-10)
  }`;
}

export interface CallEndContext {
  callId: string | null;
  callerNumber: string | null;
  endedReason: string | null;
  /** True only when the provider payload shows a real customer utterance. */
  hadCustomerUtterance: boolean;
  /** Obvious system/health/test traffic per provider metadata. */
  systemTest: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Ended reasons that mean nobody was ever on the line. */
const NON_CONVERSATION_ENDED_REASONS = [
  "no-answer",
  "voicemail",
  "busy",
  "customer-did-not-answer",
  "assistant-did-not-receive-customer-audio",
  "pipeline-error",
  "twilio-failed",
];

export function extractCallEndContext(body: unknown): CallEndContext {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const msg =
    (b.message && typeof b.message === "object" ? b.message : {}) as Record<
      string,
      unknown
    >;
  const call =
    ((msg.call ?? b.call) && typeof (msg.call ?? b.call) === "object"
      ? (msg.call ?? b.call)
      : {}) as Record<string, unknown>;
  const customer = ((msg.customer ?? call.customer ?? b.customer) &&
      typeof (msg.customer ?? call.customer ?? b.customer) === "object"
    ? (msg.customer ?? call.customer ?? b.customer)
    : {}) as Record<string, unknown>;
  const artifact =
    ((msg.artifact) && typeof msg.artifact === "object"
      ? msg.artifact
      : {}) as Record<string, unknown>;

  const callId = str(call.id) ?? str(msg.callId) ?? str(b.callId);
  const callerNumber = str(customer.number) ?? str(customer.phoneNumber) ??
    str(call.from) ?? str(call.fromNumber);
  const endedReason =
    (str(msg.endedReason) ?? str(call.endedReason) ?? "")?.toLowerCase() ||
    null;

  const transcript = str(msg.transcript) ?? str(artifact.transcript);
  const messages = Array.isArray(artifact.messages)
    ? artifact.messages
    : Array.isArray(msg.messages)
    ? (msg.messages as unknown[])
    : [];
  const spokeInPayload = messages.some((m) => {
    const r = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
    const role = String(r.role ?? "").toLowerCase();
    return (role === "user" || role === "customer") &&
      String(r.message ?? r.content ?? "").trim().length > 0;
  });
  const transcriptHasUser = !!transcript &&
    /(^|\n)\s*(user|customer)\s*:\s*\S/i.test(transcript);

  const systemTest = call.type === "webCall" && msg.isTest === true ||
    msg.isTest === true || b.isTest === true ||
    (!!endedReason &&
      NON_CONVERSATION_ENDED_REASONS.some((r) => endedReason.includes(r)));

  return {
    callId,
    callerNumber,
    endedReason,
    hadCustomerUtterance: spokeInPayload || transcriptHasUser,
    systemTest,
  };
}

export type EligibilityDecision =
  | { eligible: true }
  | { eligible: false; status: HangupFollowupStatus; detail?: string };

/**
 * Fail-closed eligibility over already-resolved conversation facts. Pure —
 * exported so every skip branch is directly testable.
 */
export function evaluateHangupFollowupEligibility(args: {
  phoneE164: string | null;
  hadCustomerUtterance: boolean;
  systemTest: boolean;
  facts: ConversationFacts | null;
}): EligibilityDecision {
  if (!args.phoneE164) {
    return { eligible: false, status: "missing_phone" };
  }
  if (args.systemTest) {
    return {
      eligible: false,
      status: "no_customer_interaction",
      detail: "system_or_test_call",
    };
  }
  if (!args.hadCustomerUtterance) {
    return { eligible: false, status: "no_customer_interaction" };
  }
  const facts = args.facts;
  if (!facts) {
    return {
      eligible: false,
      status: "no_customer_interaction",
      detail: "no_conversation",
    };
  }
  if (facts.bookingStatus === "confirmed") {
    return { eligible: false, status: "already_booked" };
  }
  const lastReason = facts.quoteByText?.lastReason ?? null;
  if (lastReason === "sent") {
    return { eligible: false, status: "already_delivered" };
  }
  if (lastReason === "cancelled") {
    return { eligible: false, status: "declined_texting" };
  }
  return { eligible: true };
}

export interface HangupFollowupInput {
  supabase: SB;
  body: unknown;
  eventType: string | null;
  /** Injected in tests. Defaults to the durable outbox. */
  deliver?: typeof sendOutboxSms;
}

/**
 * Authoritative entry point, called by voice-vapi-events for the final
 * call-ended event only. Always resolves — never throws into the webhook.
 */
export async function runVoiceHangupBidLinkFollowup(
  input: HangupFollowupInput,
): Promise<HangupFollowupResult> {
  const { supabase } = input;
  if (!isFinalCallEndedEvent(input.eventType)) {
    return { status: "not_final_event" };
  }
  const ctx = extractCallEndContext(input.body);
  const phoneE164 = normalizePhoneE164(ctx.callerNumber);

  let facts: ConversationFacts | null = null;
  if (ctx.callId) {
    try {
      const { data } = await supabase
        .from("chat_conversations")
        .select("id, facts, booking_status")
        .eq("session_token", `vapi_call:${ctx.callId}`)
        .eq("channel", "voice")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        const stored = (data.facts && typeof data.facts === "object")
          ? data.facts as ConversationFacts
          : {} as ConversationFacts;
        facts = {
          ...stored,
          bookingStatus: stored.bookingStatus ?? data.booking_status ?? "none",
        };
      }
    } catch (_e) {
      // Unreadable conversation state → fail closed, send nothing.
      return {
        status: "no_customer_interaction",
        detail: "conversation_unreadable",
      };
    }
  }

  const eligibility = evaluateHangupFollowupEligibility({
    phoneE164,
    hadCustomerUtterance: ctx.hadCustomerUtterance,
    systemTest: ctx.systemTest,
    facts,
  });
  if (!eligibility.eligible) {
    return { status: eligibility.status, detail: eligibility.detail ?? null };
  }
  const phone = phoneE164 as string;

  // Authoritative delivery-safety checks, immediately before enqueue.
  const suppression = await checkSuppression(supabase, { phone });
  if (suppression.suppressed) {
    return { status: "suppressed", detail: suppression.reason };
  }
  const optOut = await checkPhoneOptOut(supabase, phone);
  if (optOut.optedOut) {
    return {
      status: "opted_out",
      detail: optOut.readable ? null : "optout_unreadable",
    };
  }
  const pause = await getCustomerPause(supabase, { phone });
  if (pause.sms_paused) {
    return {
      status: "paused",
      detail: pause.readable ? null : "pause_unreadable",
    };
  }

  const outboundKey = buildBidLinkOutboundKey(ctx.callId as string, phone);
  const deliver = input.deliver ?? sendOutboxSms;
  const result = await deliver(supabase, {
    outboundKey,
    toNumber: phone,
    body: buildBidLinkMessage(canonicalOnlineBidUrl()),
    messageKind: VOICE_HANGUP_BID_LINK_MESSAGE_KIND,
  });
  if (result.replay || result.inProgress) {
    return { status: "duplicate", smsMessageId: result.smsMessageId ?? null };
  }
  if (result.sent) {
    return { status: "sent", smsMessageId: result.smsMessageId ?? null };
  }
  return {
    status: "failed",
    detail: result.error ?? result.outboxState ?? null,
    smsMessageId: result.smsMessageId ?? null,
  };
}
