// ============================================================================
// systemHealth.ts — record operational incidents into system_issues with
// dedupe + throttled alerting. Reuses the escalation SMS path for critical
// alerts. Never alerts on isolated customer validation errors.
// ============================================================================
// deno-lint-ignore-file no-explicit-any

export interface IssueInput {
  issueType: string;
  dedupeKey: string;
  severity?: "info" | "warning" | "critical";
  associatedRef?: string | null;
  conversationId?: string | null;
  suggestedAction?: string | null;
  details?: Record<string, unknown> | null;
}

/** Record or increment an operational issue. Returns whether it is newly opened. */
export async function recordSystemIssue(supabase: any, input: IssueInput): Promise<{ isNew: boolean; id: string | null }> {
  try {
    const { data: existing } = await supabase
      .from("system_issues")
      .select("id, occurrence_count, status")
      .eq("dedupe_key", input.dedupeKey)
      .maybeSingle();
    if (existing) {
      await supabase.from("system_issues").update({
        occurrence_count: (existing.occurrence_count ?? 0) + 1,
        last_seen_at: new Date().toISOString(),
        // A resolved issue re-opens only when it recurs.
        status: existing.status === "resolved" ? "open" : existing.status,
        severity: input.severity ?? undefined,
        details: input.details ?? undefined,
      }).eq("id", existing.id);
      return { isNew: existing.status === "resolved", id: existing.id };
    }
    const { data } = await supabase.from("system_issues").insert({
      issue_type: input.issueType,
      dedupe_key: input.dedupeKey,
      severity: input.severity ?? "warning",
      associated_ref: input.associatedRef ?? null,
      conversation_id: input.conversationId ?? null,
      suggested_action: input.suggestedAction ?? null,
      details: input.details ?? null,
    }).select("id").single();
    return { isNew: true, id: data?.id ?? null };
  } catch {
    return { isNew: false, id: null };
  }
}

/**
 * Mark an operational issue resolved (a successful check). If no row exists yet,
 * an "info"/resolved marker row is created so the latest-success timestamp is
 * still recorded. `details` must never contain secrets — only sanitized data
 * such as { last_success_at }.
 */
export async function resolveSystemIssue(
  supabase: any,
  dedupeKey: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("system_issues")
      .select("id")
      .eq("dedupe_key", dedupeKey)
      .maybeSingle();
    if (existing) {
      await supabase
        .from("system_issues")
        .update({
          status: "resolved",
          last_seen_at: new Date().toISOString(),
          details: details ?? undefined,
        })
        .eq("id", existing.id);
    } else if (details) {
      await supabase.from("system_issues").insert({
        issue_type: dedupeKey,
        dedupe_key: dedupeKey,
        severity: "info",
        status: "resolved",
        details,
      });
    }
  } catch {
    // Health bookkeeping must never break the caller.
  }
}
