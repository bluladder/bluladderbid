// ============================================================================
// voiceLinkTools — bounded Vapi tools for the thin Realtime voice MVP.
//
// The voice model may choose only WHICH customer-facing web flow is useful.
// It cannot provide a phone number, organization, link, price, booking ID, or
// any other authority-bearing argument. Those values come from the trusted
// Vapi call envelope, the already-resolved provider-to-organization mapping,
// and repository-owned canonical URLs.
//
// One call may dispatch at most one link purpose. Duplicate tool calls share
// the same durable outbox identity as the post-hangup bid-link fallback, so a
// replay, reconnect, or final event cannot produce a second SMS.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

import { getAppUrl } from "../appUrl.ts";
import {
  loadOrganizationCustomerSiteRoutes,
  type OrganizationCustomerSiteRoute,
  resolveOrganizationCustomerSite,
} from "../organizationCustomerSites.ts";
import {
  checkSuppression,
  normalizePhoneE164,
  type TransactionalPurpose,
} from "../suppression.ts";
import { checkPhoneOptOut, getCustomerPause } from "../sms.ts";
import { type OutboxSendResult, sendOutboxSms } from "../smsOutbox.ts";
import { buildVoiceCallLinkOutboundKey } from "./voiceCallLinkIdentity.ts";

type SB = any;

export const VOICE_QUOTE_LINK_TOOL = "send_online_quote_link";
export const VOICE_BOOKING_MANAGEMENT_LINK_TOOL =
  "send_booking_management_link";
export const VOICE_LINK_TOOL_NAMES = [
  VOICE_QUOTE_LINK_TOOL,
  VOICE_BOOKING_MANAGEMENT_LINK_TOOL,
] as const;
export type VoiceLinkToolName = typeof VOICE_LINK_TOOL_NAMES[number];

export type VoiceLinkToolStatus =
  | "provider_accepted"
  | "queued"
  | "uncertain"
  | "suppressed"
  | "opted_out"
  | "paused"
  | "failed"
  | "unsupported"
  | "invalid_request";

export interface VoiceLinkToolResult {
  status: VoiceLinkToolStatus;
  /** Model-facing, non-PII wording directive tied to durable evidence. */
  message: string;
}

export interface VapiToolResultEnvelope {
  results: Array<{
    toolCallId: string;
    /**
     * Vapi's synchronous custom-tool serializer accepts a single-line string.
     * Keep the structured status inside that string so Realtime receives a
     * deterministic truthfulness directive instead of its generic
     * "No result returned" fallback.
     */
    result: string;
  }>;
}

export interface ParsedVoiceToolCall {
  id: string;
  name: string;
}

export interface VoiceLinkToolEnvelopeSummary {
  messageTypeIsToolCalls: boolean;
  directCount: number;
  directWithId: number;
  directWithFlatName: number;
  directWithFunctionName: number;
  wrappedCount: number;
  wrappedWithId: number;
  wrappedWithTopName: number;
  wrappedWithToolCallName: number;
  wrappedWithFunctionName: number;
}

export interface VoiceLinkToolDeps {
  deliver?: typeof sendOutboxSms;
  suppressionCheck?: typeof checkSuppression;
  phoneOptOutCheck?: typeof checkPhoneOptOut;
  customerPauseCheck?: typeof getCustomerPause;
  /** Test injection only. Production loads the resolved tenant route. */
  customerSiteRoutes?: readonly OrganizationCustomerSiteRoute[];
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

/** Extract only the provider-supplied call/customer number; tool arguments are
 * deliberately never inspected. */
export function extractTrustedVapiCallerNumber(body: unknown): string | null {
  const top = record(body);
  const message = record(top.message);
  const call = record(message.call ?? top.call);
  const customer = record(message.customer ?? call.customer ?? top.customer);
  return normalizePhoneE164(
    nonEmptyString(customer.number) ??
      nonEmptyString(customer.phoneNumber) ??
      nonEmptyString(call.from) ??
      nonEmptyString(call.fromNumber),
  );
}

export function extractTrustedVapiCallId(body: unknown): string | null {
  const top = record(body);
  const message = record(top.message);
  const call = record(message.call ?? top.call);
  return nonEmptyString(call.id) ?? nonEmptyString(message.callId) ??
    nonEmptyString(top.callId);
}

export function parseVoiceToolCalls(body: unknown): ParsedVoiceToolCall[] {
  const top = record(body);
  const message = record(top.message);
  if (message.type !== "tool-calls") return [];

  const direct = Array.isArray(message.toolCallList)
    ? message.toolCallList.flatMap((candidate) => {
      const tool = record(candidate);
      const id = nonEmptyString(tool.id);
      // Vapi emits both its flattened tool-call representation and the
      // OpenAI-compatible function wrapper used by native Realtime lanes.
      const name = nonEmptyString(tool.name) ??
        nonEmptyString(record(tool.function).name);
      return id && name ? [{ id, name }] : [];
    })
    : [];
  if (direct.length) return direct;

  // Vapi documents toolWithToolCallList alongside toolCallList. Some provider
  // lanes retain only this wrapped representation, so accept exactly that
  // documented fallback without inspecting model-supplied parameters.
  const wrapped = Array.isArray(message.toolWithToolCallList)
    ? message.toolWithToolCallList
    : [];
  return wrapped.flatMap((candidate) => {
    const tool = record(candidate);
    const toolCall = record(tool.toolCall);
    const id = nonEmptyString(toolCall.id);
    const name = nonEmptyString(tool.name) ?? nonEmptyString(toolCall.name) ??
      nonEmptyString(record(toolCall.function).name);
    return id && name ? [{ id, name }] : [];
  });
}

/**
 * Count only non-sensitive structural markers when a provider envelope cannot
 * be parsed. Never logs arguments, identifiers, names, phone numbers, or raw
 * keys from the request.
 */
export function summarizeVoiceLinkToolEnvelope(
  body: unknown,
): VoiceLinkToolEnvelopeSummary {
  const top = record(body);
  const message = record(top.message);
  const direct = Array.isArray(message.toolCallList)
    ? message.toolCallList
    : [];
  const wrapped = Array.isArray(message.toolWithToolCallList)
    ? message.toolWithToolCallList
    : [];
  return {
    messageTypeIsToolCalls: message.type === "tool-calls",
    directCount: direct.length,
    directWithId:
      direct.filter((candidate) => nonEmptyString(record(candidate).id)).length,
    directWithFlatName:
      direct.filter((candidate) => nonEmptyString(record(candidate).name))
        .length,
    directWithFunctionName:
      direct.filter((candidate) =>
        nonEmptyString(record(record(candidate).function).name)
      ).length,
    wrappedCount: wrapped.length,
    wrappedWithId:
      wrapped.filter((candidate) =>
        nonEmptyString(record(record(candidate).toolCall).id)
      ).length,
    wrappedWithTopName:
      wrapped.filter((candidate) => nonEmptyString(record(candidate).name))
        .length,
    wrappedWithToolCallName:
      wrapped.filter((candidate) =>
        nonEmptyString(record(record(candidate).toolCall).name)
      ).length,
    wrappedWithFunctionName: wrapped.filter((candidate) =>
      nonEmptyString(
        record(record(record(candidate).toolCall).function).name,
      )
    ).length,
  };
}

export function buildVoiceCustomerLink(
  toolName: VoiceLinkToolName,
  appUrl = getAppUrl(),
): string {
  const base = appUrl.replace(/\/+$/, "");
  const url = new URL(
    toolName === VOICE_BOOKING_MANAGEMENT_LINK_TOOL
      ? `${base}/customer-portal`
      : base,
  );
  url.searchParams.set("utm_source", "voice");
  url.searchParams.set("utm_medium", "sms");
  url.searchParams.set("utm_campaign", "voice_realtime_mvp");
  return url.toString();
}

export function buildVoiceCustomerLinkMessage(
  toolName: VoiceLinkToolName,
  link: string,
): string {
  return toolName === VOICE_BOOKING_MANAGEMENT_LINK_TOOL
    ? `BluLadder: Securely view, reschedule, or cancel your appointment here: ${link}`
    : `BluLadder: Get your exact price and book online here: ${link}`;
}

function evidenceResult(
  result: OutboxSendResult,
  customerBaseUrl: string,
): VoiceLinkToolResult {
  if (result.sent) {
    return {
      status: "provider_accepted",
      message:
        "The SMS provider accepted this message. You may say the link was sent.",
    };
  }
  if (result.inProgress) {
    return {
      status: "queued",
      message:
        "The same SMS is still processing. Say it is being queued; do not say delivered.",
    };
  }
  if (result.outboxState === "delivery_unknown" || result.escalated) {
    return {
      status: "uncertain",
      message:
        `Delivery is uncertain. Do not say sent or delivered; offer ${customerBaseUrl} verbally instead.`,
    };
  }
  return {
    status: "failed",
    message:
      `The text could not be sent. Apologize briefly and direct the caller to ${customerBaseUrl}.`,
  };
}

function sameResult(
  calls: ParsedVoiceToolCall[],
  result: VoiceLinkToolResult,
): VapiToolResultEnvelope {
  const serialized = JSON.stringify(result);
  return {
    results: calls.map((call) => ({
      toolCallId: call.id,
      result: serialized,
    })),
  };
}

/**
 * Execute one exact customer-requested link purpose. Always returns Vapi's
 * documented `{ results: [{ toolCallId, result }] }` shape and never throws a
 * provider ambiguity into optimistic spoken success.
 */
export async function handleVoiceLinkToolCalls(
  supabase: SB,
  input: {
    body: unknown;
    /** Must already be resolved from mapped Vapi resources by the webhook. */
    organizationId: string;
  },
  deps: VoiceLinkToolDeps = {},
): Promise<VapiToolResultEnvelope> {
  const calls = parseVoiceToolCalls(input.body);
  if (!calls.length) return { results: [] };

  if (!nonEmptyString(input.organizationId)) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "Organization authority is unavailable. Do not claim that a text was sent.",
    });
  }

  const distinctNames = new Set(calls.map((call) => call.name));
  if (distinctNames.size !== 1) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "Competing link purposes were rejected. Ask which single link the caller wants.",
    });
  }

  const requestedName = calls[0].name;
  if (!(VOICE_LINK_TOOL_NAMES as readonly string[]).includes(requestedName)) {
    return sameResult(calls, {
      status: "unsupported",
      message:
        "That action is unavailable. Do not claim that any text or booking action occurred.",
    });
  }
  const toolName = requestedName as VoiceLinkToolName;

  const customerSiteRoutes = deps.customerSiteRoutes ??
    await loadOrganizationCustomerSiteRoutes(
      supabase,
      input.organizationId,
      { dfwBaseUrl: deps.appUrl ?? getAppUrl() },
    );
  const customerSite = resolveOrganizationCustomerSite(
    input.organizationId,
    customerSiteRoutes,
  );
  if (customerSite.status !== "resolved") {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "The customer site for this organization is unavailable. Do not send a text, disclose another location's website, or claim success.",
    });
  }

  const callId = extractTrustedVapiCallId(input.body);
  const phone = extractTrustedVapiCallerNumber(input.body);
  if (!callId || !phone) {
    return sameResult(calls, {
      status: "invalid_request",
      message:
        "The trusted caller number or call identity is missing. Do not ask the caller to dictate a number for this tool.",
    });
  }

  const suppressionCheck = deps.suppressionCheck ?? checkSuppression;
  const phoneOptOutCheck = deps.phoneOptOutCheck ?? checkPhoneOptOut;
  const customerPauseCheck = deps.customerPauseCheck ?? getCustomerPause;
  const purpose: TransactionalPurpose =
    toolName === VOICE_BOOKING_MANAGEMENT_LINK_TOOL
      ? "booking_management_requested"
      : "quote_requested";
  const [suppression, optOut, pause] = await Promise.all([
    suppressionCheck(
      supabase,
      { phone },
      { purpose, customerInitiated: true },
    ),
    phoneOptOutCheck(supabase, phone),
    customerPauseCheck(supabase, { phone }),
  ]);

  if (suppression.suppressed) {
    return sameResult(calls, {
      status: "suppressed",
      message:
        `Messaging is suppressed. Do not say sent or delivered; direct the caller to ${customerSite.baseUrl}.`,
    });
  }
  if (optOut.optedOut) {
    return sameResult(calls, {
      status: "opted_out",
      message:
        `The caller cannot receive SMS. Do not send or claim success; direct them to ${customerSite.baseUrl}.`,
    });
  }
  if (pause.sms_paused) {
    return sameResult(calls, {
      status: "paused",
      message:
        `SMS is paused for this contact. Do not say sent or delivered; direct them to ${customerSite.baseUrl}.`,
    });
  }

  const link = buildVoiceCustomerLink(toolName, customerSite.baseUrl);
  const deliver = deps.deliver ?? sendOutboxSms;
  const result = await deliver(supabase, {
    organizationId: input.organizationId,
    // Intentionally the same identity used by the final-event generic link.
    // The first accepted link purpose wins for this call and destination.
    outboundKey: buildVoiceCallLinkOutboundKey(callId, phone),
    toNumber: phone,
    body: buildVoiceCustomerLinkMessage(toolName, link),
    messageKind: toolName === VOICE_BOOKING_MANAGEMENT_LINK_TOOL
      ? "voice_booking_management_link"
      : "voice_online_quote_link",
  });
  return sameResult(calls, evidenceResult(result, customerSite.baseUrl));
}
