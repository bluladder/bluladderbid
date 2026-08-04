import { deterministicUuid } from "../deterministicUuid.ts";
import type { ChatMessage, ParsedAdapterRequest } from "../voiceAdapter.ts";
import { isProviderRecordingNotice } from "./voicePolicy.ts";

// Durable coordination is implemented by the review-only migration RPCs. No
// in-memory state participates in correctness: every isolate converges on the
// same organization/call/turn rows under a transaction-scoped advisory lock.
// deno-lint-ignore no-explicit-any
type SB = any;

export function buildSilentVoiceResponse(
  model: string,
  stream: boolean,
  buildId: string,
): Response {
  if (!stream) {
    return new Response(
      JSON.stringify({
        object: "chat.completion",
        model,
        choices: [],
        bluladder: { buildId, action: { kind: "none" }, stale: true },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export interface VoiceTurnDescriptor {
  callId: string;
  turnId: string;
  position: number;
  contentHash: string;
  /** Per-HTTP-delivery nonce; stable across automatic retries of one RPC POST. */
  claimToken: string;
  messages: ChatMessage[];
}

export function filterProviderRecordingMessages(messages: ChatMessage[]): {
  messages: ChatMessage[];
  noticesRemoved: number;
  hasCustomerSpeech: boolean;
} {
  let noticesRemoved = 0;
  const filtered = messages.filter((message) => {
    if (message.role === "user" && isProviderRecordingNotice(message.content)) {
      noticesRemoved += 1;
      return false;
    }
    return true;
  });
  return {
    messages: filtered,
    noticesRemoved,
    hasCustomerSpeech: filtered.some(
      (message) => message.role === "user" && message.content.trim().length > 0,
    ),
  };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function deriveVoiceTurnDescriptor(
  request: ParsedAdapterRequest,
): Promise<VoiceTurnDescriptor> {
  if (
    request.sessionIdIsSynthetic ||
    !request.sessionId.startsWith("vapi_call:")
  ) {
    throw new Error("authenticated_call_identity_required");
  }
  const callId = request.sessionId.slice("vapi_call:".length);
  if (!callId) throw new Error("authenticated_call_identity_required");
  const filtered = filterProviderRecordingMessages(request.messages);
  const customers = filtered.messages.filter(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  if (!customers.length) throw new Error("customer_turn_required");
  const position = customers.length;
  const cumulative = customers
    .map(
      (message, index) =>
        `${index + 1}:${message.content.replace(/\s+/g, " ").trim()}`,
    )
    .join("\n");
  const contentHash = await sha256(cumulative);
  return {
    callId,
    turnId: await deterministicUuid(
      "voice-finalized-turn",
      callId,
      String(position),
      contentHash,
    ),
    position,
    contentHash,
    claimToken: crypto.randomUUID(),
    messages: filtered.messages,
  };
}

export async function prepareVoiceIngress(
  request: ParsedAdapterRequest,
): Promise<
  | {
      status: "ignored";
      reason: "recording_notice_only" | "call_identity_required";
    }
  | { status: "accepted"; turn: VoiceTurnDescriptor }
> {
  const filtered = filterProviderRecordingMessages(request.messages);
  request.messages = filtered.messages;
  if (!filtered.hasCustomerSpeech) {
    return { status: "ignored", reason: "recording_notice_only" };
  }
  try {
    return {
      status: "accepted",
      turn: await deriveVoiceTurnDescriptor(request),
    };
  } catch {
    return { status: "ignored", reason: "call_identity_required" };
  }
}

function one(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown>) ?? null;
  return data && typeof data === "object"
    ? (data as Record<string, unknown>)
    : null;
}

export async function claimVoiceTurn(
  supabase: SB,
  args: VoiceTurnDescriptor & { organizationId: string },
): Promise<"acquired" | "duplicate" | "stale" | "wait" | "uncertain"> {
  const { data, error } = await supabase.rpc("claim_voice_turn", {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_turn_id: args.turnId,
    p_position: args.position,
    p_content_hash: args.contentHash,
    p_claim_token: args.claimToken,
  });
  if (error) throw new Error("voice_turn_claim_unavailable");
  const status = String(one(data)?.status ?? "");
  if (
    ["acquired", "duplicate", "stale", "wait", "uncertain"].includes(status)
  ) {
    return status as "acquired" | "duplicate" | "stale" | "wait" | "uncertain";
  }
  throw new Error("voice_turn_claim_invalid");
}

export async function completeVoiceTurn(
  supabase: SB,
  args: {
    organizationId: string;
    callId: string;
    turnId: string;
  },
): Promise<void> {
  const { error } = await supabase.rpc("complete_voice_turn", {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_turn_id: args.turnId,
  });
  if (error) throw new Error("voice_turn_completion_unavailable");
}

export async function markVoiceTurnUncertain(
  supabase: SB,
  args: { organizationId: string; callId: string; turnId: string },
): Promise<void> {
  await supabase.rpc("mark_voice_turn_uncertain", {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_turn_id: args.turnId,
  });
}

export async function isAuthoritativeVoiceTurn(
  supabase: SB,
  args: {
    organizationId: string;
    callId: string;
    turnId: string;
  },
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_authoritative_voice_turn", {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_turn_id: args.turnId,
  });
  if (error) return false;
  return one(data)?.authoritative === true || data === true;
}

export async function runClaimedExternalAction<T>(
  supabase: SB,
  args: {
    organizationId: string;
    callId: string;
    turnId: string;
    actionKey: string;
    run: () => Promise<T>;
    uncertain: () => T;
  },
): Promise<T> {
  const claimToken = crypto.randomUUID();
  const { data, error } = await supabase.rpc("claim_voice_external_action", {
    p_organization_id: args.organizationId,
    p_call_id: args.callId,
    p_turn_id: args.turnId,
    p_action_key: args.actionKey,
    p_claim_token: claimToken,
  });
  if (error || one(data)?.status !== "acquired") return args.uncertain();
  try {
    const result = await args.run();
    const record =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : null;
    const nested =
      record?.json && typeof record.json === "object"
        ? (record.json as Record<string, unknown>)
        : null;
    const outcome = [record?.status, nested?.status].some(
      (status) => String(status ?? "").toLowerCase() === "uncertain",
    )
      ? "uncertain"
      : "completed";
    const finish = await supabase.rpc("finish_voice_external_action", {
      p_organization_id: args.organizationId,
      p_call_id: args.callId,
      p_turn_id: args.turnId,
      p_action_key: args.actionKey,
      p_outcome: outcome,
    });
    if (finish.error) return args.uncertain();
    return result;
  } catch {
    const finish = await supabase.rpc("finish_voice_external_action", {
      p_organization_id: args.organizationId,
      p_call_id: args.callId,
      p_turn_id: args.turnId,
      p_action_key: args.actionKey,
      p_outcome: "uncertain",
    });
    if (finish.error) return args.uncertain();
    return args.uncertain();
  }
}
