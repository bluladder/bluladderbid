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
// The Phase 1G organization-scoped boundary extends this state machine to
// reviewed organization connectors. Legacy deployed paths remain unchanged
// until their separately gated runtime wave.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import {
  type CallRailConfig,
  getCallRailConfig,
  sendCallRailSms,
} from "./sms.ts";
import {
  guardMessagingDispatch,
  type OrganizationMessagingConnectorConfig,
  selectOrganizationMessagingConnector,
} from "./messagingConnectorContracts.ts";
import {
  resolveTwilioSmsConfig,
  sendTwilioSms,
  type TwilioSmsConfig,
} from "./twilioSms.ts";

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
  provider?: string | null;
  reason?: string;
}

export interface OutboxSendInput {
  /** Server-resolved tenant authority. Never derive this from the recipient. */
  organizationId: string;
  outboundKey: string;
  toNumber: string;
  body: string;
  messageKind: string;
  quoteId?: string;
  callRail?: CallRailConfig | null;
  twilio?: TwilioSmsConfig | null;
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

async function selectSmsConnector(
  supabase: SB,
  organizationId: string,
): Promise<
  | { status: "resolved"; connector: OrganizationMessagingConnectorConfig }
  | { status: "blocked"; reason: string }
> {
  const { data, error } = await supabase
    .from("organization_messaging_connectors")
    .select(
      "id, organization_id, channel, provider, status, priority, credential_reference, sender_identity_reference",
    )
    .eq("organization_id", organizationId)
    .eq("channel", "sms");
  if (error) {
    return { status: "blocked", reason: "connector_lookup_unavailable" };
  }
  const candidates: OrganizationMessagingConnectorConfig[] = (data ?? []).map(
    (row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      organizationId: String(row.organization_id ?? ""),
      channel: row.channel as "sms",
      provider: row
        .provider as OrganizationMessagingConnectorConfig["provider"],
      status: row.status as OrganizationMessagingConnectorConfig["status"],
      priority: Number(row.priority ?? 0),
      credentialReference: typeof row.credential_reference === "string"
        ? row.credential_reference
        : null,
      senderIdentityReference: typeof row.sender_identity_reference === "string"
        ? row.sender_identity_reference
        : null,
    }),
  );
  const selected = selectOrganizationMessagingConnector(
    organizationId,
    "sms",
    candidates,
  );
  return selected.status === "resolved"
    ? selected
    : { status: "blocked", reason: selected.code };
}

/**
 * Attempt to send an outbound SMS through the outbox state machine.
 *
 * 1. `claim_sms_outbox_send` atomically records intent (state = 'sending')
 *    OR returns existing evidence for the same outbound key.
 * 2. If the claim declares us winner (`may_dispatch=true, is_new=true`) we
 *    call the selected reviewed provider adapter exactly once.
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
  const selection = await selectSmsConnector(supabase, input.organizationId);
  if (selection.status !== "resolved") {
    return {
      sent: false,
      smsMessageId: null,
      outboxState: null,
      replay: false,
      inProgress: false,
      escalated: false,
      providerMessageId: null,
      error: selection.reason,
    };
  }
  const dispatchGuard = guardMessagingDispatch(selection.connector, {
    organizationId: input.organizationId,
    connectorId: selection.connector.id,
    channel: "sms",
    idempotencyKey: input.outboundKey,
  });
  if (dispatchGuard.status !== "authorized") {
    return {
      sent: false,
      smsMessageId: null,
      outboxState: null,
      replay: false,
      inProgress: false,
      escalated: false,
      providerMessageId: null,
      error: dispatchGuard.code,
    };
  }

  const claimToken = crypto.randomUUID();
  const claimArgs: Record<string, unknown> = {
    p_organization_id: input.organizationId,
    p_messaging_connector_id: selection.connector.id,
    p_outbound_key: input.outboundKey,
    p_claim_token: claimToken,
    p_to_number: input.toNumber,
    p_body: input.body,
    p_message_kind: input.messageKind,
    p_quote_id: input.quoteId ?? null,
    p_stale_claim_seconds: 120,
  };
  const { data: claimData, error: claimErr } = await supabase.rpc(
    "claim_organization_sms_outbox_send",
    claimArgs,
  );
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

  // Not the winner — return existing evidence; do not call any provider.
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

  // Winner — dispatch through the selected adapter exactly once. Everything
  // from this point must finalize the row (success, failure, or unknown).
  let providerMessageId: string | null = null;
  let providerConversationId: string | null = null;
  let providerStatus: string | null = null;
  let providerResponseKind: string | null = null;
  let newState: OutboxState = "delivery_unknown";
  let errText: string | null = null;

  if (selection.connector.provider === "twilio") {
    const twilio = input.twilio ?? resolveTwilioSmsConfig(
      selection.connector.credentialReference,
      selection.connector.senderIdentityReference,
    );
    if (!twilio) {
      newState = "send_failed";
      errText = "twilio_config_missing";
    } else {
      try {
        const res = await sendTwilioSms(twilio, input.toNumber, input.body);
        providerMessageId = res.messageId ?? null;
        providerStatus = res.providerMessageStatus ?? null;
        providerResponseKind = res.providerResponseKind ?? null;
        if (res.ok) {
          newState = "provider_accepted";
        } else if (
          res.providerResponseKind === "transport_uncertain" ||
          res.providerResponseKind === "provider_ambiguous"
        ) {
          newState = "delivery_unknown";
          errText = res.error ?? "provider_ambiguous_response";
        } else {
          newState = "send_failed";
          errText = res.error ?? "twilio_send_failed";
        }
      } catch {
        newState = "delivery_unknown";
        errText = "twilio_dispatch_uncertain";
      }
    }
  } else if (selection.connector.provider !== "callrail") {
    newState = "send_failed";
    errText = "provider_adapter_unavailable";
  } else {
    const callrail = input.callRail ?? getCallRailConfig();
    if (!callrail) {
      newState = "send_failed";
      errText = "callrail_config_missing";
    } else {
      try {
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
      }
    }
  }

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
