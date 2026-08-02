// ============================================================================
// Bounded Vapi end-of-call transcript/message ingestion.
//
// Stores only sanitized user/assistant text in the canonical chat journal.
// Raw payloads, recordings, credentials and unbounded transcript blobs are
// never persisted. Deterministic message ids make duplicate reports safe.
// ============================================================================

import { extractCallEndContext } from "./hangupBidLinkFollowup.ts";
import {
  recordVoiceTurns,
  sanitizeTurnContent,
  VOICE_TRANSCRIPT_RETENTION_DAYS,
  voiceTranscriptRetentionExpiresAt,
  type VoiceTurn,
  type VoiceTurnJournalResult,
} from "./turnJournal.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export const VAPI_ARTIFACT_MAX_MESSAGES = 200;
export const VAPI_ARTIFACT_RETENTION_DAYS = VOICE_TRANSCRIPT_RETENTION_DAYS;

export interface VapiArtifactJournalResult extends VoiceTurnJournalResult {
  status: "persisted" | "duplicate" | "ignored" | "error";
  callId: string | null;
  conversationId: string | null;
  sourceMessages: number;
  skippedExisting: number;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function providerMessages(body: unknown): unknown[] {
  const top = object(body);
  const message = object(top.message);
  const artifact = object(message.artifact);
  if (Array.isArray(artifact.messages)) return artifact.messages;
  if (Array.isArray(message.messages)) return message.messages;
  return [];
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function turnsFromMessages(messages: unknown[]): VoiceTurn[] {
  return messages.slice(0, VAPI_ARTIFACT_MAX_MESSAGES).flatMap((raw, index) => {
    const row = object(raw);
    const providerRole = String(row.role ?? "").toLowerCase();
    const role = providerRole === "user" || providerRole === "customer"
      ? "user" as const
      : providerRole === "assistant" || providerRole === "bot"
      ? "assistant" as const
      : null;
    const content = sanitizeTurnContent(
      typeof row.message === "string"
        ? row.message
        : typeof row.content === "string"
        ? row.content
        : "",
    );
    if (!role || !content) return [];
    return [{
      role,
      content,
      providerTimestamp: timestamp(
        row.timestamp ?? row.createdAt ?? row.created_at ?? row.time,
      ),
      providerSequence: index,
    }];
  });
}

function turnsFromTranscript(body: unknown): VoiceTurn[] {
  const top = object(body);
  const message = object(top.message);
  const artifact = object(message.artifact);
  const transcript = typeof artifact.transcript === "string"
    ? artifact.transcript
    : typeof message.transcript === "string"
    ? message.transcript
    : "";
  if (!transcript) return [];
  return transcript.split(/\r?\n/).slice(0, VAPI_ARTIFACT_MAX_MESSAGES)
    .flatMap((line, index) => {
      const match = line.match(
        /^\s*(user|customer|assistant|bot)\s*:\s*(.+)$/i,
      );
      if (!match) return [];
      const content = sanitizeTurnContent(match[2]);
      if (!content) return [];
      return [{
        role: /user|customer/i.test(match[1])
          ? "user" as const
          : "assistant" as const,
        content,
        providerSequence: index,
      }];
    });
}

/** Remove turns already journaled live, preserving repeated-phrase counts. */
function subtractExisting(
  turns: VoiceTurn[],
  existing: Array<{ role?: unknown; content?: unknown }>,
): { turns: VoiceTurn[]; skipped: number } {
  const counts = new Map<string, number>();
  for (const row of existing) {
    const key = `${String(row.role ?? "")}|${
      sanitizeTurnContent(String(row.content ?? ""))
    }`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let skipped = 0;
  const remaining = turns.filter((turn) => {
    const key = `${turn.role}|${turn.content}`;
    const count = counts.get(key) ?? 0;
    if (count <= 0) return true;
    counts.set(key, count - 1);
    skipped += 1;
    return false;
  });
  return { turns: remaining, skipped };
}

export async function persistVapiEndOfCallArtifacts(
  supabase: SB,
  args: { body: unknown; organizationId: string },
): Promise<VapiArtifactJournalResult> {
  const context = extractCallEndContext(args.body);
  if (!context.callId) {
    return {
      status: "ignored",
      callId: null,
      conversationId: null,
      sourceMessages: 0,
      skippedExisting: 0,
      written: 0,
      duplicates: 0,
      failed: 0,
    };
  }
  const providerCallId = `vapi_call:${context.callId}`;
  try {
    const conversation = await supabase.from("chat_conversations")
      .select("id, organization_id")
      .eq("session_token", providerCallId)
      .eq("channel", "voice")
      .eq("organization_id", args.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (conversation?.error || !conversation?.data) {
      return {
        status: "error",
        callId: context.callId,
        conversationId: null,
        sourceMessages: 0,
        skippedExisting: 0,
        written: 0,
        duplicates: 0,
        failed: 0,
        reason: "conversation_authority_mismatch",
      };
    }
    const conversationId = String(conversation.data.id);
    const messages = providerMessages(args.body);
    const sourceTurns = messages.length
      ? turnsFromMessages(messages)
      : turnsFromTranscript(args.body);
    if (!sourceTurns.length) {
      return {
        status: "ignored",
        callId: context.callId,
        conversationId,
        sourceMessages: 0,
        skippedExisting: 0,
        written: 0,
        duplicates: 0,
        failed: 0,
      };
    }

    let existingRows: Array<{ role?: unknown; content?: unknown }> = [];
    try {
      const existing = await supabase.from("chat_messages")
        .select("role, content")
        .eq("conversation_id", conversationId)
        .contains("ai_metadata", { provider_call_id: providerCallId })
        .limit(VAPI_ARTIFACT_MAX_MESSAGES * 2);
      existingRows = Array.isArray(existing?.data) ? existing.data : [];
    } catch { /* deterministic ids still protect duplicate reports */ }
    const missing = subtractExisting(sourceTurns, existingRows);
    if (!missing.turns.length) {
      return {
        status: "duplicate",
        callId: context.callId,
        conversationId,
        sourceMessages: sourceTurns.length,
        skippedExisting: missing.skipped,
        written: 0,
        duplicates: sourceTurns.length,
        failed: 0,
      };
    }

    const retention = voiceTranscriptRetentionExpiresAt();
    let written = 0;
    let duplicates = 0;
    let failed = 0;
    for (let index = 0; index < missing.turns.length; index++) {
      const providerSequence = missing.turns[index].providerSequence ?? index;
      const result = await recordVoiceTurns(supabase, {
        conversationId,
        organizationId: args.organizationId,
        callId: providerCallId,
        turnIdentity: `end-of-call:${providerSequence}`,
        state: "end_of_call_report",
        source: "end_of_call",
        retentionExpiresAt: retention,
        turns: [missing.turns[index]],
      });
      written += result.written;
      duplicates += result.duplicates;
      failed += result.failed;
    }
    return {
      status: failed > 0 ? "error" : written > 0 ? "persisted" : "duplicate",
      callId: context.callId,
      conversationId,
      sourceMessages: sourceTurns.length,
      skippedExisting: missing.skipped,
      written,
      duplicates,
      failed,
      ...(failed > 0 ? { reason: "journal_write_failed" as const } : {}),
    };
  } catch {
    return {
      status: "error",
      callId: context.callId,
      conversationId: null,
      sourceMessages: 0,
      skippedExisting: 0,
      written: 0,
      duplicates: 0,
      failed: 0,
      reason: "journal_write_failed",
    };
  }
}
