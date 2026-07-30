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

// deno-lint-ignore no-explicit-any
type SB = any;

const MAX_CONTENT = 4000;

const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|rk|pk)_[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi,
  /\beyJ[A-Za-z0-9._-]{16,}/g, // JWT-shaped
  /\b(?:api[_-]?key|secret|token|password|authorization)\s*[:=]\s*\S+/gi,
];

/** Remove anything credential-shaped and clamp length. */
export function sanitizeTurnContent(content: string | null | undefined): string {
  let out = String(content ?? "");
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length > MAX_CONTENT) out = `${out.slice(0, MAX_CONTENT)}…`;
  return out;
}

export interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

export function buildTurnRows(args: {
  conversationId: string;
  callId?: string | null;
  state?: string | null;
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
      },
    }))
    .filter((r) => (r.content as string).length > 0);
}

/** Best-effort persistence. Journaling must never break a live call. */
export async function recordVoiceTurns(
  supabase: SB,
  args: { conversationId: string; callId?: string | null; state?: string | null; turns: VoiceTurn[] },
): Promise<{ written: number }> {
  const rows = buildTurnRows(args);
  if (rows.length === 0) return { written: 0 };
  try {
    const { error } = await supabase.from("chat_messages").insert(rows);
    if (error) return { written: 0 };
    return { written: rows.length };
  } catch (_e) {
    return { written: 0 };
  }
}
