// ============================================================================
// turnJournal.ts — minimal sanitized voice turn journal.
//
// Incident 019fb423-7a5b-7990-98fe-6e7db8062f50 could not be reconstructed from
// our own data because voice turns were never persisted: only the mutated
// quote_sessions row survived, and provider-side adapter logs had aged out.
//
// Voice user/assistant turns are now written to the SAME canonical
// chat_messages table the web channel uses, linked to the conversation (and
// therefore to the Vapi call id via chat_conversations.session_token).
//
// Sanitization rules:
//   * Never persist secrets, tokens, keys or Authorization material.
//   * Never persist raw provider credentials or full provider payloads.
//   * Content is truncated so a runaway transcript cannot bloat the table.
// ============================================================================

import { deterministicUuid } from "../deterministicUuid.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

const MAX_CONTENT = 4000;
export const VOICE_TRANSCRIPT_RETENTION_DAYS = 30;

export function voiceTranscriptRetentionExpiresAt(
  now = Date.now(),
): string {
  return new Date(
    now + VOICE_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\beyJ[A-Za-z0-9._-]{16,}/g, // JWT-shaped
  /\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi,
];

/** Remove anything credential-shaped and clamp length. */
export function sanitizeTurnContent(
  content: string | null | undefined,
): string {
  let out = String(content ?? "");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MAX_CONTENT) out = `${out.slice(0, MAX_CONTENT)}…`;
  return out;
}

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
  /** Provider timestamp only; never a customer-supplied metadata bag. */
  providerTimestamp?: string | null;
  /** Stable zero-based position from a bounded provider artifact. */
  providerSequence?: number | null;
}

export interface VoiceControllerJournalMessage {
  role: string;
  content: string;
}

export async function buildControllerTurnJournalIdentity(args: {
  callId: string;
  messages: VoiceControllerJournalMessage[];
}): Promise<string> {
  const nonSystem = args.messages.filter((message) =>
    message.role !== "system" && message.role !== "tool"
  );
  let lastUserIndex = -1;
  for (let index = nonSystem.length - 1; index >= 0; index--) {
    if (nonSystem[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  const userMessage = lastUserIndex >= 0
    ? nonSystem[lastUserIndex].content
    : "";
  return await deterministicUuid(
    "voice-controller-request",
    args.callId,
    String(nonSystem.length),
    String(lastUserIndex),
    userMessage,
  );
}

export type VoiceTurnJournalSource = "controller" | "legacy" | "end_of_call";

export function buildTurnRows(args: {
  conversationId: string;
  callId?: string | null;
  state?: string | null;
  source?: VoiceTurnJournalSource;
  retentionExpiresAt?: string | null;
  turns: VoiceTurn[];
}): Record<string, unknown>[] {
  return args.turns
    .map((t) => ({
      conversation_id: args.conversationId,
      role: t.role,
      content: sanitizeTurnContent(t.content),
      ai_metadata: {
        channel: "voice",
        provider_call_id: args.callId ?? null,
        state: args.state ?? null,
        source: args.source ?? "legacy",
        provider_message_at: t.providerTimestamp ?? null,
        provider_message_sequence: t.providerSequence ?? null,
        retention_expires_at: args.retentionExpiresAt ?? null,
      },
    }))
    .filter((r) => (r.content as string).length > 0);
}

/**
 * Build stable primary keys for a provider turn. The caller supplies a turn
 * identity derived from the authenticated call id plus the request's message
 * position. A provider retry therefore converges on the same rows, while a
 * caller deliberately repeating the same words later still gets a new turn.
 */
export async function buildIdempotentTurnRows(args: {
  conversationId: string;
  callId: string;
  turnIdentity: string;
  state?: string | null;
  source: VoiceTurnJournalSource;
  retentionExpiresAt?: string | null;
  turnId?: string | null;
  turnPosition?: number | null;
  contentHash?: string | null;
  turns: VoiceTurn[];
}): Promise<Record<string, unknown>[]> {
  const base = buildTurnRows(args);
  return await Promise.all(base.map(async (row, index) => ({
    id: await deterministicUuid(
      "voice-turn-journal",
      args.conversationId,
      args.callId,
      args.turnIdentity,
      String(index),
      String(row.role ?? ""),
    ),
    ...row,
    ai_metadata: {
      ...(row.ai_metadata as Record<string, unknown>),
      turn_identity: args.turnIdentity,
      ...(args.turnId ? { turn_id: args.turnId } : {}),
      ...(args.turnPosition !== null && args.turnPosition !== undefined
        ? { turn_position: args.turnPosition }
        : {}),
      ...(args.contentHash ? { content_hash: args.contentHash } : {}),
    },
  })));
}

export interface VoiceTurnJournalResult {
  written: number;
  duplicates: number;
  failed: number;
  reason?:
    | "conversation_authority_unavailable"
    | "conversation_authority_mismatch"
    | "journal_write_failed";
}

/** Best-effort persistence. Journaling must never break a live call. */
export async function recordVoiceTurns(
  supabase: SB,
  args: {
    conversationId: string;
    callId?: string | null;
    state?: string | null;
    source?: VoiceTurnJournalSource;
    /** Mandatory for tenant-safe controller and end-of-call persistence. */
    organizationId?: string | null;
    /** Mandatory with callId for retry-safe writes. */
    turnIdentity?: string | null;
    /** Documented retention deadline for provider-derived artifacts. */
    retentionExpiresAt?: string | null;
    /** Exact single-flight lineage used only for completed-turn replay. */
    turnId?: string | null;
    turnPosition?: number | null;
    contentHash?: string | null;
    turns: VoiceTurn[];
  },
): Promise<VoiceTurnJournalResult> {
  const idempotent = !!args.callId && !!args.turnIdentity;
  const rows = idempotent
    ? await buildIdempotentTurnRows({
      conversationId: args.conversationId,
      callId: args.callId!,
      turnIdentity: args.turnIdentity!,
      state: args.state,
      source: args.source ?? "controller",
      retentionExpiresAt: args.retentionExpiresAt,
      turnId: args.turnId,
      turnPosition: args.turnPosition,
      contentHash: args.contentHash,
      turns: args.turns,
    })
    : buildTurnRows(args);
  if (rows.length === 0) return { written: 0, duplicates: 0, failed: 0 };
  try {
    // Service-role callers still prove that the target conversation belongs
    // to the server-derived organization before writing tenant-owned turns.
    if (args.organizationId) {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id, organization_id")
        .eq("id", args.conversationId)
        .eq("organization_id", args.organizationId)
        .maybeSingle();
      if (error) {
        return {
          written: 0,
          duplicates: 0,
          failed: rows.length,
          reason: "conversation_authority_unavailable",
        };
      }
      if (!data) {
        return {
          written: 0,
          duplicates: 0,
          failed: rows.length,
          reason: "conversation_authority_mismatch",
        };
      }
    }

    if (!idempotent) {
      const { error } = await supabase.from("chat_messages").insert(rows);
      if (error) {
        return {
          written: 0,
          duplicates: 0,
          failed: rows.length,
          reason: "journal_write_failed",
        };
      }
      return { written: rows.length, duplicates: 0, failed: 0 };
    }

    let written = 0;
    let duplicates = 0;
    let failed = 0;
    for (const row of rows) {
      const { error } = await supabase.from("chat_messages").insert(row);
      if (!error) {
        written += 1;
        continue;
      }
      // A deterministic-id conflict is a replay only when the winner belongs
      // to this exact conversation. Any unreadable/mismatched winner fails.
      const winner = await supabase.from("chat_messages")
        .select("id, conversation_id")
        .eq("id", row.id)
        .eq("conversation_id", args.conversationId)
        .maybeSingle();
      if (!winner?.error && winner?.data) duplicates += 1;
      else failed += 1;
    }
    return {
      written,
      duplicates,
      failed,
      ...(failed > 0 ? { reason: "journal_write_failed" as const } : {}),
    };
  } catch (_e) {
    return {
      written: 0,
      duplicates: 0,
      failed: rows.length,
      reason: "journal_write_failed",
    };
  }
}

export type VoiceTurnReplayRead =
  | { status: "found"; spoken: string; authoritativeTurnId?: string }
  | {
    status: "unavailable";
    reason:
      | "conversation_unavailable"
      | "conversation_ambiguous"
      | "reply_missing"
      | "reply_lineage_mismatch"
      | "latest_claim_unavailable"
      | "latest_claim_ambiguous";
  };

/**
 * Read the one canonical controller reply for an exact completed turn.
 * This performs no writes and never falls back to provider artifacts.
 */
export async function readReplayableControllerReply(
  supabase: SB,
  args: {
    organizationId: string;
    sessionToken: string;
    turnId: string;
    turnPosition: number;
    contentHash: string;
    messages: VoiceControllerJournalMessage[];
  },
): Promise<VoiceTurnReplayRead> {
  try {
    const conversationRead = await supabase
      .from("chat_conversations")
      .select("id, organization_id, session_token, channel")
      .eq("organization_id", args.organizationId)
      .eq("session_token", args.sessionToken)
      .eq("channel", "voice")
      .limit(2);
    if (conversationRead?.error) {
      return { status: "unavailable", reason: "conversation_unavailable" };
    }
    const conversations = Array.isArray(conversationRead?.data)
      ? conversationRead.data
      : [];
    if (conversations.length !== 1) {
      return {
        status: "unavailable",
        reason: conversations.length > 1
          ? "conversation_ambiguous"
          : "conversation_unavailable",
      };
    }
    const conversationId = String(conversations[0].id ?? "");
    if (!conversationId) {
      return { status: "unavailable", reason: "conversation_unavailable" };
    }
    const turnIdentity = await buildControllerTurnJournalIdentity({
      callId: args.sessionToken,
      messages: args.messages,
    });
    const assistantRowId = await deterministicUuid(
      "voice-turn-journal",
      conversationId,
      args.sessionToken,
      turnIdentity,
      "1",
      "assistant",
    );
    const replyRead = await supabase.from("chat_messages")
      .select("id, conversation_id, role, content, ai_metadata")
      .eq("id", assistantRowId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (replyRead?.error || !replyRead?.data) {
      return { status: "unavailable", reason: "reply_missing" };
    }
    const row = replyRead.data as Record<string, unknown>;
    const metadata = row.ai_metadata && typeof row.ai_metadata === "object"
      ? row.ai_metadata as Record<string, unknown>
      : {};
    const spoken = sanitizeTurnContent(String(row.content ?? ""));
    if (
      row.role !== "assistant" || !spoken ||
      metadata.channel !== "voice" ||
      metadata.source !== "controller" ||
      metadata.provider_call_id !== args.sessionToken ||
      metadata.turn_identity !== turnIdentity ||
      metadata.turn_id !== args.turnId ||
      metadata.turn_position !== args.turnPosition ||
      metadata.content_hash !== args.contentHash
    ) {
      return { status: "unavailable", reason: "reply_lineage_mismatch" };
    }
    return { status: "found", spoken };
  } catch {
    return { status: "unavailable", reason: "conversation_unavailable" };
  }
}

/**
 * Read the latest completed controller reply for a stale provider request.
 * This is intentionally separate from exact-turn replay and is safe only when
 * the caller immediately rechecks authority for the returned turn id. Every
 * read remains scoped to the server-resolved organization and authenticated
 * call; a row with any mismatched journal lineage is rejected.
 */
export async function readLatestReplayableControllerReply(
  supabase: SB,
  args: {
    organizationId: string;
    /** Raw authenticated provider call id used by voice_turn_claims. */
    callId: string;
    /** Canonical vapi_call:<id> conversation/journal token. */
    sessionToken: string;
  },
): Promise<VoiceTurnReplayRead> {
  try {
    const conversationRead = await supabase
      .from("chat_conversations")
      .select("id, organization_id, session_token, channel")
      .eq("organization_id", args.organizationId)
      .eq("session_token", args.sessionToken)
      .eq("channel", "voice")
      .limit(2);
    if (conversationRead?.error) {
      return { status: "unavailable", reason: "conversation_unavailable" };
    }
    const conversations = Array.isArray(conversationRead?.data)
      ? conversationRead.data
      : [];
    if (conversations.length !== 1) {
      return {
        status: "unavailable",
        reason: conversations.length > 1
          ? "conversation_ambiguous"
          : "conversation_unavailable",
      };
    }
    const conversationId = String(conversations[0].id ?? "");
    if (!conversationId) {
      return { status: "unavailable", reason: "conversation_unavailable" };
    }

    const claimRead = await supabase
      .from("voice_turn_claims")
      .select(
        "organization_id, call_id, turn_id, position, content_hash, status",
      )
      .eq("organization_id", args.organizationId)
      .eq("call_id", args.callId)
      .eq("status", "completed")
      .order("position", { ascending: false })
      .limit(2);
    if (claimRead?.error) {
      return { status: "unavailable", reason: "latest_claim_unavailable" };
    }
    const claims = Array.isArray(claimRead?.data) ? claimRead.data : [];
    if (!claims.length) {
      return { status: "unavailable", reason: "latest_claim_unavailable" };
    }
    const claim = claims[0] as Record<string, unknown>;
    const turnId = String(claim.turn_id ?? "");
    const position = Number(claim.position);
    const contentHash = String(claim.content_hash ?? "");
    if (
      claim.organization_id !== args.organizationId ||
      claim.call_id !== args.callId ||
      claim.status !== "completed" ||
      !/^[0-9a-f-]{36}$/i.test(turnId) ||
      !Number.isInteger(position) || position < 1 ||
      !/^[0-9a-f]{64}$/i.test(contentHash) ||
      (claims[1] && Number(claims[1].position) >= position)
    ) {
      return { status: "unavailable", reason: "latest_claim_ambiguous" };
    }

    const replyRead = await supabase.from("chat_messages")
      .select("id, conversation_id, role, content, ai_metadata")
      .eq("conversation_id", conversationId)
      .eq("role", "assistant")
      .eq("ai_metadata->>channel", "voice")
      .eq("ai_metadata->>source", "controller")
      .eq("ai_metadata->>provider_call_id", args.sessionToken)
      .eq("ai_metadata->>turn_id", turnId)
      .eq("ai_metadata->>turn_position", String(position))
      .eq("ai_metadata->>content_hash", contentHash)
      .limit(2);
    if (replyRead?.error) {
      return { status: "unavailable", reason: "reply_missing" };
    }
    const replies = Array.isArray(replyRead?.data) ? replyRead.data : [];
    if (replies.length !== 1) {
      return {
        status: "unavailable",
        reason: replies.length > 1 ? "reply_lineage_mismatch" : "reply_missing",
      };
    }
    const row = replies[0] as Record<string, unknown>;
    const metadata = row.ai_metadata && typeof row.ai_metadata === "object"
      ? row.ai_metadata as Record<string, unknown>
      : {};
    const spoken = sanitizeTurnContent(String(row.content ?? ""));
    if (
      row.conversation_id !== conversationId || row.role !== "assistant" ||
      !spoken || metadata.channel !== "voice" ||
      metadata.source !== "controller" ||
      metadata.provider_call_id !== args.sessionToken ||
      metadata.turn_id !== turnId || metadata.turn_position !== position ||
      metadata.content_hash !== contentHash
    ) {
      return { status: "unavailable", reason: "reply_lineage_mismatch" };
    }
    return { status: "found", spoken, authoritativeTurnId: turnId };
  } catch {
    return { status: "unavailable", reason: "latest_claim_unavailable" };
  }
}
