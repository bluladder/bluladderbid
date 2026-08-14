// ============================================================================
// Tenant-safe, idempotent human transfer for the thin Realtime voice lane.
//
// The model supplies no destination, tenant, phone, call identity, or reason.
// Those values come only from the authenticated Vapi envelope and the already
// resolved organization. One deterministic operational-note claim prevents a
// replay from issuing a second provider transfer. A failed or uncertain
// transfer uses the same authoritative operator contact for one idempotent SMS
// and email follow-up alert; a provider-accepted transfer does not alert.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { getAppUrl } from "../appUrl.ts";
import { deterministicUuid } from "../deterministicUuid.ts";
import { sendEmail, type SendEmailResult } from "../emailConfig.ts";
import { checkSuppression } from "../suppression.ts";
import { type OutboxSendResult, sendOutboxSms } from "../smsOutbox.ts";
import {
  normalizeE164,
  resolveTransferDestination,
} from "../voiceTransferResolver.ts";
import {
  extractTrustedVapiCallerNumber,
  extractTrustedVapiCallId,
  parseVoiceToolCalls,
  type VapiToolResultEnvelope,
} from "./voiceLinkTools.ts";
import { buildVoiceCallLinkOutboundKey } from "./voiceCallLinkIdentity.ts";

type SB = any;

export const VOICE_HUMAN_TRANSFER_TOOL = "request_human_transfer";
export const VOICE_HUMAN_TRANSFER_NOTE_VERSION = "voice-human-transfer-v1";
export const VOICE_OPERATOR_ALERT_EMAIL_TEMPLATE = "voice_operator_alert";
export const VOICE_TRANSFER_CONTROL_TIMEOUT_MS = 4_000;

export type VoiceHumanTransferStatus =
  | "transfer_requested"
  | "followup_provider_accepted"
  | "followup_recorded"
  | "uncertain"
  | "failed"
  | "unsupported"
  | "invalid_request";

export interface VoiceHumanTransferToolResult {
  status: VoiceHumanTransferStatus;
  message: string;
}

export interface VoiceOperatorContact {
  id: string;
  name: string;
  phoneE164: string;
  email: string | null;
}

export interface VoiceTransferControlResult {
  status: "provider_accepted" | "failed" | "uncertain";
  httpStatus: number | null;
}

export interface VoiceTransferClaim {
  state:
    | "winner"
    | "provider_accepted"
    | "failed"
    | "uncertain"
    | "in_progress";
  conversationId: string;
  noteId: string;
  callHash: string;
  customerId: string | null;
}

export interface VoiceOperatorAlertResult {
  sms:
    | "provider_accepted"
    | "queued"
    | "failed"
    | "uncertain"
    | "suppressed"
    | "skipped";
  email:
    | "provider_accepted"
    | "failed"
    | "uncertain"
    | "suppressed"
    | "skipped";
  providerAccepted: boolean;
}

export type VoicePriorCustomerLinkState =
  | "none"
  | "provider_accepted"
  | "unreadable";

export interface VoiceHumanTransferDeps {
  resolveOperator?: typeof resolveAuthoritativeVoiceOperator;
  claimTransfer?: typeof claimVoiceTransferAttempt;
  finishTransfer?: typeof finishVoiceTransferAttempt;
  executeTransfer?: typeof executeVapiTransferControl;
  notifyOperator?: typeof notifyVoiceOperatorFollowup;
  deliverSms?: typeof sendOutboxSms;
  sendOperatorEmail?: typeof sendEmail;
  suppressionCheck?: typeof checkSuppression;
  inspectPriorCustomerLink?: typeof inspectPriorVoiceCustomerLink;
  appUrl?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function sameResult(
  calls: Array<{ id: string }>,
  result: VoiceHumanTransferToolResult,
): VapiToolResultEnvelope {
  const serialized = JSON.stringify(result);
  return {
    results: calls.map((call) => ({
      toolCallId: call.id,
      result: serialized,
    })),
  };
}

export function extractTrustedVapiControlUrl(body: unknown): string | null {
  const top = record(body);
  const message = record(top.message);
  const call = record(message.call ?? top.call);
  return nonEmptyString(record(call.monitor).controlUrl);
}

export function extractTrustedVapiProviderDid(body: unknown): string | null {
  const top = record(body);
  const message = record(top.message);
  const call = record(message.call ?? top.call);
  const phoneNumber = record(
    message.phoneNumber ?? call.phoneNumber ?? top.phoneNumber,
  );
  return normalizeE164(
    nonEmptyString(phoneNumber.number) ??
      nonEmptyString(call.phoneNumberNumber) ??
      nonEmptyString(call.to) ??
      nonEmptyString(call.toNumber),
  );
}

/**
 * Validate the opaque live-control capability supplied by Vapi's authenticated
 * call envelope. Vapi's contract requires posting directly to controlUrl; its
 * path and query are provider-managed and must never be reconstructed.
 */
export function normalizeVapiControlEndpoint(value: string): string | null {
  try {
    if (!value || value !== value.trim()) return null;
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    const hostname = url.hostname.toLowerCase();
    if (!(hostname === "vapi.ai" || hostname.endsWith(".vapi.ai"))) return null;
    if (!url.pathname || url.pathname === "/") return null;
    if (url.hash) return null;
    return value;
  } catch {
    return null;
  }
}

export async function executeVapiTransferControl(
  controlUrl: string,
  destinationE164: string,
  fetcher: typeof fetch = fetch,
): Promise<VoiceTransferControlResult> {
  const endpoint = normalizeVapiControlEndpoint(controlUrl);
  if (!endpoint) return { status: "failed", httpStatus: null };
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "transfer",
        destination: { type: "number", number: destinationE164 },
        content: "Transferring you now.",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(VOICE_TRANSFER_CONTROL_TIMEOUT_MS),
    });
    try {
      await response.body?.cancel();
    } catch { /* no-op */ }
    return response.ok
      ? { status: "provider_accepted", httpStatus: response.status }
      : { status: "failed", httpStatus: response.status };
  } catch {
    // The provider may have received the request before transport failed. Do
    // not retry and do not convert this into optimistic success.
    return { status: "uncertain", httpStatus: null };
  }
}

export async function resolveAuthoritativeVoiceOperator(
  supabase: SB,
  organizationId: string,
): Promise<
  | { status: "resolved"; contact: VoiceOperatorContact }
  | { status: "unavailable"; reason: string }
> {
  try {
    const { data, error } = await supabase.from("escalation_recipients")
      .select(
        "id, organization_id, name, phone, email, role, is_enabled, verified_at",
      )
      .eq("organization_id", organizationId)
      .eq("role", "primary")
      .eq("is_enabled", true)
      .not("verified_at", "is", null)
      .limit(2);
    if (error) return { status: "unavailable", reason: "lookup_failed" };
    const rows = Array.isArray(data) ? data : [];
    if (rows.length !== 1) {
      return {
        status: "unavailable",
        reason: rows.length ? "ambiguous_primary" : "missing_primary",
      };
    }
    const row = rows[0];
    if (row.organization_id !== organizationId) {
      return { status: "unavailable", reason: "organization_mismatch" };
    }
    const phoneE164 = normalizeE164(row.phone);
    if (!phoneE164) {
      return { status: "unavailable", reason: "invalid_primary_phone" };
    }
    const email = nonEmptyString(row.email);
    return {
      status: "resolved",
      contact: {
        id: String(row.id),
        name: String(row.name ?? "Local operator").slice(0, 80),
        phoneE164,
        email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
          ? email.toLowerCase()
          : null,
      },
    };
  } catch {
    return { status: "unavailable", reason: "lookup_failed" };
  }
}

/**
 * A provider-accepted customer link and a transfer are mutually exclusive in
 * one call. This durable read makes that rule independent of model behavior.
 * The lookup uses only trusted call identity + ANI and returns no message body,
 * provider identifier, or customer content.
 */
export async function inspectPriorVoiceCustomerLink(
  supabase: SB,
  args: { callId: string; callerPhone: string },
): Promise<VoicePriorCustomerLinkState> {
  try {
    const outboundKey = buildVoiceCallLinkOutboundKey(
      args.callId,
      args.callerPhone,
    );
    const { data, error } = await supabase.from("sms_messages")
      .select(
        "outbound_idempotency_key, to_number, message_kind, outbox_state, status",
      )
      .eq("outbound_idempotency_key", outboundKey)
      .limit(2);
    if (error) return "unreadable";
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) return "none";
    if (rows.length !== 1) return "unreadable";

    const row = rows[0];
    const expectedKinds = new Set([
      "voice_booking_management_link",
      "voice_online_quote_link",
    ]);
    if (
      row.outbound_idempotency_key !== outboundKey ||
      normalizeE164(row.to_number) !== args.callerPhone ||
      !expectedKinds.has(String(row.message_kind ?? ""))
    ) {
      return "unreadable";
    }
    return row.outbox_state === "provider_accepted" || row.status === "sent"
      ? "provider_accepted"
      : "none";
  } catch {
    return "unreadable";
  }
}

async function ensureVoiceCallConversation(
  supabase: SB,
  args: { organizationId: string; callId: string; callerPhone: string },
): Promise<{ conversationId: string; customerId: string | null }> {
  const sessionToken = `vapi_call:${args.callId}`;
  const existing = await supabase.from("chat_conversations")
    .select("id, organization_id, channel, session_token, customer_id")
    .eq("session_token", sessionToken)
    .eq("channel", "voice")
    .order("created_at", { ascending: false })
    .limit(2);
  if (existing?.error) throw new Error("conversation_lookup_failed");
  const rows = Array.isArray(existing?.data) ? existing.data : [];
  if (rows.length > 1) throw new Error("conversation_authority_ambiguous");
  if (rows.length === 1) {
    const row = rows[0];
    if (
      row.organization_id !== args.organizationId || row.channel !== "voice" ||
      row.session_token !== sessionToken
    ) {
      throw new Error("conversation_authority_mismatch");
    }
    return {
      conversationId: String(row.id),
      customerId: nonEmptyString(row.customer_id),
    };
  }

  const conversationId = await deterministicUuid(
    "voice-conversation",
    args.organizationId,
    sessionToken,
  );
  const created = await supabase.from("chat_conversations").insert({
    id: conversationId,
    session_token: sessionToken,
    channel: "voice",
    organization_id: args.organizationId,
    // Trusted ANI is a contact candidate, never customer or booking authority.
    prospect_phone: args.callerPhone,
  }).select("id, organization_id, channel, session_token, customer_id")
    .single();
  if (
    !created?.error && created?.data?.organization_id === args.organizationId
  ) {
    return { conversationId, customerId: null };
  }
  const winner = await supabase.from("chat_conversations")
    .select("id, organization_id, channel, session_token, customer_id")
    .eq("id", conversationId)
    .eq("organization_id", args.organizationId)
    .maybeSingle();
  if (
    winner?.error || !winner?.data || winner.data.channel !== "voice" ||
    winner.data.session_token !== sessionToken
  ) {
    throw new Error("conversation_insert_failed");
  }
  return {
    conversationId,
    customerId: nonEmptyString(winner.data.customer_id),
  };
}

function claimState(value: unknown): VoiceTransferClaim["state"] {
  const state = nonEmptyString(value);
  return state === "provider_accepted" || state === "failed" ||
      state === "uncertain"
    ? state
    : "in_progress";
}

export async function claimVoiceTransferAttempt(
  supabase: SB,
  args: { organizationId: string; callId: string; callerPhone: string },
): Promise<VoiceTransferClaim> {
  const conversation = await ensureVoiceCallConversation(supabase, args);
  const callHash = await sha256Hex(args.callId);
  const noteId = await deterministicUuid(
    "voice-human-transfer-note",
    args.organizationId,
    callHash,
    VOICE_HUMAN_TRANSFER_NOTE_VERSION,
  );
  const adminUrl =
    `${getAppUrl()}/admin?tab=conversations&conversation=${conversation.conversationId}`;
  const row = {
    id: noteId,
    conversation_id: conversation.conversationId,
    role: "system",
    content: [
      "Human transfer requested.",
      `Caller contact: ${args.callerPhone}.`,
      "Transfer status: in progress.",
      `Open: ${adminUrl}`,
    ].join("\n"),
    ai_metadata: {
      channel: "voice",
      source: "voice_human_transfer",
      note_version: VOICE_HUMAN_TRANSFER_NOTE_VERSION,
      note_identity: noteId,
      organization_id: args.organizationId,
      call_identity_sha256: callHash,
      transfer_control_status: "in_progress",
      callback_notification_status: "not_requested",
      customer_id: conversation.customerId,
      pricing_authority: false,
      address_authority: false,
      booking_authority: false,
    },
  };
  const inserted = await supabase.from("chat_messages").insert(row);
  if (!inserted?.error) {
    return {
      state: "winner",
      conversationId: conversation.conversationId,
      noteId,
      callHash,
      customerId: conversation.customerId,
    };
  }
  const winner = await supabase.from("chat_messages")
    .select("id, conversation_id, ai_metadata")
    .eq("id", noteId)
    .eq("conversation_id", conversation.conversationId)
    .contains("ai_metadata", { note_identity: noteId })
    .maybeSingle();
  if (winner?.error || !winner?.data) throw new Error("transfer_claim_failed");
  return {
    state: claimState(
      record(winner.data.ai_metadata).transfer_control_status,
    ),
    conversationId: conversation.conversationId,
    noteId,
    callHash,
    customerId: nonEmptyString(record(winner.data.ai_metadata).customer_id),
  };
}

export async function finishVoiceTransferAttempt(
  supabase: SB,
  args: {
    claim: VoiceTransferClaim;
    organizationId: string;
    callerPhone: string;
    transferStatus: "provider_accepted" | "failed" | "uncertain";
    alert: VoiceOperatorAlertResult | null;
    appUrl?: string;
  },
): Promise<boolean> {
  const adminUrl = `${
    (args.appUrl ?? getAppUrl()).replace(/\/+$/, "")
  }/admin?tab=conversations&conversation=${args.claim.conversationId}`;
  const alertStatus = args.alert?.providerAccepted
    ? "provider_accepted"
    : args.alert
    ? "recorded_not_confirmed"
    : "not_requested";
  const content = [
    "Human transfer requested.",
    `Caller contact: ${args.callerPhone}.`,
    `Transfer status: ${args.transferStatus.replaceAll("_", " ")}.`,
    args.transferStatus === "provider_accepted"
      ? "A transfer control request was accepted; a human answer was not verified."
      : args.alert?.providerAccepted
      ? "The local operator alert was accepted by at least one provider."
      : "A local callback request was recorded; alert delivery was not confirmed.",
    `Open: ${adminUrl}`,
  ].join("\n");
  const updated = await supabase.from("chat_messages").update({
    content,
    ai_metadata: {
      channel: "voice",
      source: "voice_human_transfer",
      note_version: VOICE_HUMAN_TRANSFER_NOTE_VERSION,
      note_identity: args.claim.noteId,
      organization_id: args.organizationId,
      call_identity_sha256: args.claim.callHash,
      transfer_control_status: args.transferStatus,
      callback_notification_status: alertStatus,
      callback_notification_channels: {
        sms: args.alert?.sms ?? "not_requested",
        email: args.alert?.email ?? "not_requested",
      },
      customer_id: args.claim.customerId,
      pricing_authority: false,
      address_authority: false,
      booking_authority: false,
    },
  }).eq("id", args.claim.noteId)
    .eq("conversation_id", args.claim.conversationId)
    .contains("ai_metadata", { note_identity: args.claim.noteId })
    .select("id, conversation_id, ai_metadata")
    .maybeSingle();
  const updatedMetadata = record(updated?.data?.ai_metadata);
  if (
    updated?.error || updated?.data?.id !== args.claim.noteId ||
    updated?.data?.conversation_id !== args.claim.conversationId ||
    updatedMetadata.note_identity !== args.claim.noteId ||
    updatedMetadata.source !== "voice_human_transfer" ||
    updatedMetadata.transfer_control_status !== args.transferStatus ||
    updatedMetadata.callback_notification_status !== alertStatus
  ) {
    return false;
  }
  if (args.transferStatus !== "provider_accepted") {
    const conversation = await supabase.from("chat_conversations").update({
      callback_requested: true,
      needs_attention: true,
      manual_review_reason: "voice_human_transfer_followup",
    }).eq("id", args.claim.conversationId)
      .eq("organization_id", args.organizationId)
      .select("id, callback_requested, needs_attention, manual_review_reason")
      .maybeSingle();
    if (
      conversation?.error ||
      conversation?.data?.id !== args.claim.conversationId ||
      conversation?.data?.callback_requested !== true ||
      conversation?.data?.needs_attention !== true ||
      conversation?.data?.manual_review_reason !==
        "voice_human_transfer_followup"
    ) {
      return false;
    }
  }
  return true;
}

function operatorAlertBody(args: {
  callerPhone: string;
  transferStatus: "failed" | "uncertain";
  conversationId: string;
  appUrl: string;
}): string {
  const adminUrl = `${
    args.appUrl.replace(/\/+$/, "")
  }/admin?tab=conversations&conversation=${args.conversationId}`;
  return [
    "BluLadder voice follow-up",
    `Caller: ${args.callerPhone}`,
    "Request: human help",
    `Transfer: ${args.transferStatus}`,
    "Action: contact the caller and review the conversation.",
    `Open: ${adminUrl}`,
  ].join("\n");
}

function emailHtml(body: string): string {
  return `<pre style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${
    body.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string),
    )
  }</pre>`;
}

function classifyVoiceOperatorEmailEvidence(
  row: Record<string, unknown> | null,
): VoiceOperatorAlertResult["email"] {
  if (!row) return "uncertain";
  const status = nonEmptyString(row.status);
  const providerMessageId = nonEmptyString(row.provider_message_id);
  const failureCategory = nonEmptyString(row.failure_category);
  if (
    (status === "accepted" || status === "delivered") && providerMessageId
  ) {
    return "provider_accepted";
  }
  if (status === "suppressed") return "suppressed";
  if (failureCategory === "provider_accepted_without_message_id") {
    return "uncertain";
  }
  if (
    status === "failed" || status === "bounced" || status === "complained"
  ) {
    return "failed";
  }
  return "uncertain";
}

/**
 * Persist the provider result in the existing outbound-email attempt ledger.
 * A 2xx response is not model-facing provider evidence unless it includes a
 * provider correlation id and the exact call-scoped row is readable afterward.
 */
export async function recordVoiceOperatorEmailAttempt(
  supabase: SB,
  args: {
    organizationId: string;
    transferStatus: "failed" | "uncertain";
    contact: VoiceOperatorContact;
    claim: VoiceTransferClaim;
  },
  result: SendEmailResult,
): Promise<VoiceOperatorAlertResult["email"]> {
  const providerMessageId = nonEmptyString(result.providerMessageId);
  const accepted = result.ok && !!providerMessageId;
  const providerAcceptedWithoutId = result.ok && !providerMessageId;
  const suppressed = result.failure?.category === "suppressed";
  const status = accepted ? "accepted" : suppressed ? "suppressed" : "failed";
  const attemptId = await deterministicUuid(
    "voice-operator-email-attempt",
    args.organizationId,
    args.claim.callHash,
    args.contact.id,
    VOICE_HUMAN_TRANSFER_NOTE_VERSION,
  );
  const submittedAt = new Date().toISOString();
  const row = {
    id: attemptId,
    quote_id: null,
    template: VOICE_OPERATOR_ALERT_EMAIL_TEMPLATE,
    recipient_email: args.contact.email,
    provider: "resend",
    provider_message_id: providerMessageId,
    status,
    failure_category: providerAcceptedWithoutId
      ? "provider_accepted_without_message_id"
      : result.failure?.category ?? null,
    failure_reason: providerAcceptedWithoutId
      ? "Provider accepted the request without a correlation id."
      : result.failure?.message ?? null,
    http_status: result.httpStatus,
    source_session_id: args.claim.conversationId,
    submitted_at: submittedAt,
    accepted_at: accepted ? submittedAt : null,
    suppressed_at: suppressed ? submittedAt : null,
    metadata: {
      source: "voice_human_transfer",
      organization_id: args.organizationId,
      conversation_id: args.claim.conversationId,
      call_identity_sha256: args.claim.callHash,
      transfer_control_status: args.transferStatus,
      note_identity: args.claim.noteId,
    },
  };
  const columns = "id, status, provider_message_id, failure_category, metadata";
  let persisted: Record<string, unknown> | null = null;
  try {
    const inserted = await supabase.from("email_send_attempts").insert(row)
      .select(columns)
      .maybeSingle();
    if (!inserted?.error && inserted?.data) {
      persisted = record(inserted.data);
    } else {
      const existing = await supabase.from("email_send_attempts")
        .select(columns)
        .eq("id", attemptId)
        .contains("metadata", {
          source: "voice_human_transfer",
          organization_id: args.organizationId,
          call_identity_sha256: args.claim.callHash,
        })
        .maybeSingle();
      if (!existing?.error && existing?.data) {
        persisted = record(existing.data);
      }
    }
  } catch {
    persisted = null;
  }
  const evidence = classifyVoiceOperatorEmailEvidence(persisted);
  if (accepted && evidence !== "provider_accepted") return "uncertain";
  if (providerAcceptedWithoutId) return "uncertain";
  if (!accepted && !persisted) return suppressed ? "suppressed" : "failed";
  return evidence;
}

function smsDeliveryStatus(
  result: OutboxSendResult,
): VoiceOperatorAlertResult["sms"] {
  const durableId = nonEmptyString(result.smsMessageId);
  if (
    result.sent && durableId && result.outboxState === "provider_accepted"
  ) {
    return "provider_accepted";
  }
  if (result.inProgress && durableId) return "queued";
  if (result.sent || result.inProgress) return "uncertain";
  return "failed";
}

export async function notifyVoiceOperatorFollowup(
  supabase: SB,
  args: {
    organizationId: string;
    callerPhone: string;
    transferStatus: "failed" | "uncertain";
    contact: VoiceOperatorContact;
    claim: VoiceTransferClaim;
    appUrl?: string;
  },
  deps: Pick<
    VoiceHumanTransferDeps,
    "deliverSms" | "sendOperatorEmail" | "suppressionCheck"
  > = {},
): Promise<VoiceOperatorAlertResult> {
  const appUrl = args.appUrl ?? getAppUrl();
  const body = operatorAlertBody({
    callerPhone: args.callerPhone,
    transferStatus: args.transferStatus,
    conversationId: args.claim.conversationId,
    appUrl,
  });
  let alertsEnabled = false;
  let emailEnabled = false;
  try {
    const { data } = await supabase.from("escalation_settings")
      .select("internal_alerts_enabled, email_alerts_enabled")
      .eq("singleton", true)
      .maybeSingle();
    alertsEnabled = data?.internal_alerts_enabled === true;
    emailEnabled = data?.email_alerts_enabled === true;
  } catch { /* both stay disabled */ }

  const suppressionCheck = deps.suppressionCheck ?? checkSuppression;
  let sms: VoiceOperatorAlertResult["sms"] = "skipped";
  if (alertsEnabled && args.contact.phoneE164 !== args.callerPhone) {
    const suppression = await suppressionCheck(supabase, {
      phone: args.contact.phoneE164,
    });
    if (suppression.suppressed) {
      sms = "suppressed";
    } else {
      const deliverSms = deps.deliverSms ?? sendOutboxSms;
      const result = await deliverSms(supabase, {
        organizationId: args.organizationId,
        outboundKey:
          `voice_operator_alert:${args.organizationId}:${args.claim.callHash}:human_transfer`,
        toNumber: args.contact.phoneE164,
        body,
        messageKind: "voice_operator_alert",
      });
      sms = smsDeliveryStatus(result);
    }
  }

  let email: VoiceOperatorAlertResult["email"] = "skipped";
  if (emailEnabled && args.contact.email) {
    const suppression = await suppressionCheck(supabase, {
      email: args.contact.email,
    });
    if (suppression.suppressed) {
      email = "suppressed";
    } else {
      const sendOperatorEmail = deps.sendOperatorEmail ?? sendEmail;
      const result = await sendOperatorEmail({
        to: args.contact.email,
        subject: "BluLadder voice caller needs human follow-up",
        html: emailHtml(body),
        fromNameOverride: "BluLadder Alerts",
        idempotencyKey:
          `voice-operator-alert-${args.organizationId}-${args.claim.callHash}`,
      });
      email = await recordVoiceOperatorEmailAttempt(supabase, args, result);
    }
  }
  return {
    sms,
    email,
    providerAccepted: sms === "provider_accepted" ||
      email === "provider_accepted",
  };
}

function replayResult(
  state: VoiceTransferClaim["state"],
): VoiceHumanTransferToolResult {
  if (state === "provider_accepted") {
    return {
      status: "transfer_requested",
      message:
        "Vapi already accepted this transfer request. Do not issue another transfer or claim that a human answered.",
    };
  }
  if (state === "failed") {
    return {
      status: "followup_recorded",
      message:
        "The transfer could not be completed. A callback request was already recorded; do not claim notification delivery or a human answer.",
    };
  }
  return {
    status: "uncertain",
    message:
      "Transfer completion is uncertain. Do not retry, do not claim connection, and say a callback request is recorded only if the prior tool result said so.",
  };
}

export async function handleVoiceHumanTransferToolCalls(
  supabase: SB,
  input: { body: unknown; organizationId: string },
  deps: VoiceHumanTransferDeps = {},
): Promise<VapiToolResultEnvelope> {
  const calls = parseVoiceToolCalls(input.body);
  if (!calls.length) return { results: [] };
  const names = new Set(calls.map((call) => call.name));
  if (names.size !== 1) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "Competing actions were rejected. Do not claim a transfer or text occurred.",
    });
  }
  if (calls[0].name !== VOICE_HUMAN_TRANSFER_TOOL) {
    return sameResult(calls, {
      status: "unsupported",
      message: "That action is unavailable. Do not claim it occurred.",
    });
  }
  if (!nonEmptyString(input.organizationId)) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "Organization authority is unavailable. Do not claim a transfer or callback.",
    });
  }
  const callId = extractTrustedVapiCallId(input.body);
  const callerPhone = extractTrustedVapiCallerNumber(input.body);
  if (!callId || !callerPhone) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "Trusted call identity is missing. Do not ask the caller to provide a transfer destination.",
    });
  }

  // Unit tests inject all external behavior while using a null client. In the
  // live handler a service-role client is always present, so the durable guard
  // always runs before a transfer claim or provider request.
  if (supabase || deps.inspectPriorCustomerLink) {
    const inspectPriorCustomerLink = deps.inspectPriorCustomerLink ??
      inspectPriorVoiceCustomerLink;
    let priorLink: VoicePriorCustomerLinkState = "unreadable";
    try {
      priorLink = await inspectPriorCustomerLink(supabase, {
        callId,
        callerPhone,
      });
    } catch {
      priorLink = "unreadable";
    }
    if (priorLink === "provider_accepted") {
      return sameResult(calls, {
        status: "invalid_request",
        message:
          "A customer link was already provider-accepted for this call. Do not transfer or alert an operator; acknowledge the link once and end politely.",
      });
    }
    if (priorLink === "unreadable") {
      return sameResult(calls, {
        status: "failed",
        message:
          "Prior call actions could not be verified. Do not transfer or alert an operator; apologize briefly and direct the caller to bid.bluladder.com.",
      });
    }
  }

  const claimTransfer = deps.claimTransfer ?? claimVoiceTransferAttempt;
  let claim: VoiceTransferClaim;
  try {
    claim = await claimTransfer(supabase, {
      organizationId: input.organizationId,
      callId,
      callerPhone,
    });
  } catch {
    return sameResult(calls, {
      status: "failed",
      message:
        "The transfer request could not be recorded. Do not claim transfer or callback success; direct the caller to bid.bluladder.com.",
    });
  }
  if (claim.state !== "winner") {
    return sameResult(calls, replayResult(claim.state));
  }

  const resolveOperator = deps.resolveOperator ??
    resolveAuthoritativeVoiceOperator;
  let resolved: Awaited<ReturnType<typeof resolveAuthoritativeVoiceOperator>>;
  try {
    resolved = await resolveOperator(supabase, input.organizationId);
  } catch {
    resolved = { status: "unavailable", reason: "lookup_failed" };
  }
  let transferStatus: "provider_accepted" | "failed" | "uncertain" = "failed";
  let contact: VoiceOperatorContact | null = null;
  if (resolved.status === "resolved") {
    contact = resolved.contact;
    const destination = resolveTransferDestination({
      configuredDestination: contact.phoneE164,
      currentCallerAni: callerPhone,
      providerDid: extractTrustedVapiProviderDid(input.body),
    });
    const controlUrl = extractTrustedVapiControlUrl(input.body);
    if (destination.ok && controlUrl) {
      const executeTransfer = deps.executeTransfer ??
        executeVapiTransferControl;
      try {
        transferStatus = (await executeTransfer(
          controlUrl,
          destination.destinationE164,
        )).status;
      } catch {
        transferStatus = "uncertain";
      }
    }
  }

  let alert: VoiceOperatorAlertResult | null = null;
  if (transferStatus !== "provider_accepted" && contact) {
    const notifyOperator = deps.notifyOperator ?? notifyVoiceOperatorFollowup;
    try {
      alert = await notifyOperator(supabase, {
        organizationId: input.organizationId,
        callerPhone,
        transferStatus,
        contact,
        claim,
        appUrl: deps.appUrl,
      }, deps);
    } catch {
      alert = null;
    }
  }
  const finishTransfer = deps.finishTransfer ?? finishVoiceTransferAttempt;
  let recorded = false;
  try {
    recorded = await finishTransfer(supabase, {
      claim,
      organizationId: input.organizationId,
      callerPhone,
      transferStatus,
      alert,
      appUrl: deps.appUrl,
    });
  } catch {
    /* durable claim remains; replay will not issue another transfer */
  }

  if (transferStatus === "provider_accepted") {
    return sameResult(calls, {
      status: "transfer_requested",
      message:
        "Vapi accepted the transfer control request. Say you are connecting the caller now; do not claim that a human answered.",
    });
  }
  if (alert?.providerAccepted && recorded) {
    return sameResult(calls, {
      status: "followup_provider_accepted",
      message:
        "The transfer could not be completed. An operator alert was provider-accepted; say the team was alerted to call back, but do not claim a human answered.",
    });
  }
  if (alert?.providerAccepted && !recorded) {
    return sameResult(calls, {
      status: "uncertain",
      message:
        "An operator alert may have been provider-accepted, but durable callback evidence could not be verified. Do not claim alert delivery or a human answer.",
    });
  }
  if (recorded) {
    return sameResult(calls, {
      status: transferStatus === "uncertain"
        ? "uncertain"
        : "followup_recorded",
      message: transferStatus === "uncertain"
        ? "Transfer completion is uncertain. A callback request was recorded, but notification delivery is not confirmed. Do not claim connection or alert delivery."
        : "The transfer could not be completed. A callback request was recorded, but notification delivery is not confirmed. Say exactly that and do not claim a human answered.",
    });
  }
  return sameResult(calls, {
    status: "failed",
    message:
      "The transfer and callback record both failed. Do not claim success; direct the caller to bid.bluladder.com.",
  });
}
