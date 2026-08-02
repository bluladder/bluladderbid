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
