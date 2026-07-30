// ============================================================================
// smsOutbox — Phase 6B.3 outbox state machine for high-value autonomous SMS.
//
// Ordinary SMS sends go through `sendAutonomousCallRailSms` which INSERTs the
// `sms_messages` row *after* the provider call returns. That order leaves a
// crash window: if the process dies after CallRail accepted but before the
// insert, a retry could re-dispatch and the customer sees a duplicate.
//
// For the booking-confirmation boundary that duplicate is catastrophic ("You
// were booked twice"). This module reserves the outbox row BEFORE the
// provider call and finalizes it AFTER, so every possible outcome — success,
// hard failure, or crash mid-flight — leaves durable evidence keyed by
// `outbound_idempotency_key`.
//
// Only used at the `booking_confirmation:{ledger_id}` boundary. All other
// autonomous sends continue to use `sendAutonomousCallRailSms`.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  type CallRailConfig,
  getCallRailConfig,
  sendCallRailSms,
} from "./sms.ts";

type SB = any;

export type OutboxState =
  | "pending_send"
  | "sending"
  | "provider_accepted"
  | "send_failed"
  | "delivery_unknown";

export interface OutboxClaim {
  ok: boolean;
  is_new?: boolean;
  id?: string | null;
  outbox_state?: OutboxState | null;
  status?: string | null;
  may_dispatch?: boolean;
  replay?: boolean;
  in_progress?: boolean;
  escalated?: boolean;
  provider_message_id?: string | null;
  reason?: string;
}

export interface OutboxSendInput {
  outboundKey: string;
  toNumber: string;
  body: string;
  messageKind: string;
  quoteId?: string;
  callRail?: CallRailConfig | null;
}

export interface OutboxSendResult {
  sent: boolean;
  smsMessageId: string | null;
  outboxState: OutboxState | null;
  replay: boolean;
  inProgress: boolean;
  escalated: boolean;
  providerMessageId: string | null;
  error?: string;
}

/** True when the backend has no such RPC (PostgREST 404 / Postgres 42883). */
function isMissingFunctionError(err: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42883" ||
    msg.includes("could not find the function") ||
    msg.includes("does not exist");
}

/**
 * Attempt to send an outbound SMS through the outbox state machine.
 *
 * 1. `claim_sms_outbox_send` atomically records intent (state = 'sending')
 *    OR returns existing evidence for the same outbound key.
 * 2. If the claim declares us winner (`may_dispatch=true, is_new=true`) we
 *    call CallRail exactly once.
 * 3. `finalize_sms_outbox_send` transitions the row to the terminal state,
 *    guarded by the claim token so a stale worker cannot overwrite a
 *    successor's outcome.
 *
 * On any thrown / malformed provider response the state becomes
 * `delivery_unknown` — a reconciliation worker can inspect provider status
 * later; the caller must NOT re-dispatch.
 */
export async function sendOutboxSms(
  supabase: SB,
  input: OutboxSendInput,
): Promise<OutboxSendResult> {
  const callrail = input.callRail ?? getCallRailConfig();

  const claimToken = crypto.randomUUID();
  const claimRpc = input.quoteId
    ? "claim_quote_sms_delivery"
    : "claim_sms_outbox_send";
  const claimArgs: Record<string, unknown> = {
    p_outbound_key: input.outboundKey,
    p_claim_token: claimToken,
    p_to_number: input.toNumber,
    p_body: input.body,
    p_message_kind: input.messageKind,
  };
  if (input.quoteId) claimArgs.p_quote_id = input.quoteId;
  let { data: claimData, error: claimErr } = await supabase.rpc(
    claimRpc,
    claimArgs,
  );
  // Compatibility fallback: environments where the quote-specific wrapper
  // (claim_quote_sms_delivery) has not been provisioned yet must still be able
  // to deliver a customer-requested quote SMS. The base outbox claim keeps the
  // same semantic outbound key (so idempotency is unchanged); quote lineage is
  // then bound with a narrow, conflict-safe update below.
  let quoteLineageFallback = false;
  if (
    claimErr && input.quoteId &&
    isMissingFunctionError(claimErr)
  ) {
    quoteLineageFallback = true;
    const base = await supabase.rpc("claim_sms_outbox_send", {
      p_outbound_key: input.outboundKey,
      p_claim_token: claimToken,
      p_to_number: input.toNumber,
      p_body: input.body,
      p_message_kind: input.messageKind,
      // PostgREST function resolution requires the complete exposed signature,
      // even though Postgres itself declares this argument with a default.
      p_stale_claim_seconds: 120,
    });
    claimData = base.data;
    claimErr = base.error;
  }
  if (claimErr) {
    return {
      sent: false,
      smsMessageId: null,
      outboxState: null,
      replay: false,
      inProgress: false,
      escalated: false,
      providerMessageId: null,
      error: `claim_error:${claimErr.message}`,
    };
  }
  const claim = (claimData ?? {}) as OutboxClaim;
  if (!claim.ok || !claim.id) {
    return {
      sent: false,
      smsMessageId: null,
      outboxState: null,
      replay: false,
      inProgress: false,
      escalated: false,
      providerMessageId: null,
      error: claim.reason ?? "claim_denied",
    };
  }

  if (quoteLineageFallback && input.quoteId) {
    const { error: lineageErr } = await supabase
      .from("sms_messages")
      .update({ quote_id: input.quoteId })
      .eq("id", claim.id)
      .is("quote_id", null);
    if (lineageErr) {
      return {
        sent: false,
        smsMessageId: claim.id,
        outboxState: (claim.outbox_state ?? null) as OutboxState | null,
        replay: false,
        inProgress: false,
        escalated: false,
        providerMessageId: null,
        error: "quote_lineage_conflict",
      };
    }
  }

  // Not the winner — return existing evidence, do NOT call CallRail.
  if (!claim.may_dispatch) {
    const priorAccepted = claim.outbox_state === "provider_accepted" ||
      claim.status === "sent";
    return {
      sent: priorAccepted,
      smsMessageId: claim.id,
      outboxState: (claim.outbox_state ?? null) as OutboxState | null,
      replay: claim.replay === true,
      inProgress: claim.in_progress === true,
      escalated: claim.escalated === true,
      providerMessageId: claim.provider_message_id ?? null,
    };
  }

  // Winner — dispatch to CallRail exactly once. Everything from this point
  // must finalize the row (success, failure, or unknown).
  let providerMessageId: string | null = null;
  let providerConversationId: string | null = null;
  let providerStatus: string | null = null;
  let providerResponseKind: string | null = null;
  let newState: OutboxState = "delivery_unknown";
  let errText: string | null = null;

  if (!callrail) {
    newState = "send_failed";
    errText = "callrail_config_missing";
  } else {try {
      const res = await sendCallRailSms(callrail, input.toNumber, input.body);
      providerMessageId = res.messageId ?? null;
      providerConversationId = res.conversationId ?? null;
      providerStatus = res.providerMessageStatus ?? null;
      providerResponseKind = res.providerResponseKind ?? null;
      if (res.ok) {
        newState = "provider_accepted";
      } else if (
        res.error && res.providerResponseKind !== "transport_uncertain"
      ) {
        newState = "send_failed";
        errText = res.error;
      } else {
        newState = "delivery_unknown";
        errText = res.error ?? "provider_ambiguous_response";
      }
    } catch (e) {
      // Thrown after possibly-successful dispatch. We CANNOT know whether
      // CallRail accepted. Mark delivery_unknown; reconciliation owns it.
      newState = "delivery_unknown";
      errText = `dispatch_threw:${String(e).slice(0, 180)}`;
    }}

  const { data: finalized, error: finalizeError } = await supabase.rpc(
    "finalize_sms_outbox_send",
    {
      p_sms_message_id: claim.id,
      p_claim_token: claimToken,
      p_new_state: newState,
      p_provider_message_id: providerMessageId,
      p_provider_conversation_id: providerConversationId,
      p_provider_status: providerStatus,
      p_provider_response_kind: providerResponseKind,
      p_error: errText,
    },
  );
  if (finalizeError || !finalized?.ok) {
    return {
      sent: false,
      smsMessageId: claim.id,
      outboxState: "delivery_unknown",
      replay: false,
      inProgress: false,
      escalated: true,
      providerMessageId,
      error: "delivery_finalization_uncertain",
    };
  }

  return {
    sent: newState === "provider_accepted",
    smsMessageId: claim.id,
    outboxState: newState,
    replay: false,
    inProgress: false,
    escalated: false,
    providerMessageId,
    error: newState === "provider_accepted" ? undefined : errText ?? undefined,
  };
}
