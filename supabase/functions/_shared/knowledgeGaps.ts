// ============================================================================
// knowledgeGaps.ts — track unanswered / weakly-answered questions so admins can
// turn them into approved knowledge. One normalized gap accumulates repeated
// or rephrased questions (single row, incremented counts).
// ============================================================================
// deno-lint-ignore-file no-explicit-any

const STOPWORDS = new Set([
  "the","a","an","is","are","do","does","can","could","would","you","your","i",
  "we","to","of","for","and","or","my","me","please","how","what","when","where",
  "much","it","that","this","in","on","with","about","have","has","will",
]);

/** Normalize a question into a stable key so rephrasings collapse into one gap. */
export function normalizeQuestion(raw: string): string {
  const words = String(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const uniq = Array.from(new Set(words)).sort();
  return uniq.slice(0, 8).join(" ").trim();
}

export interface GapInput {
  question: string;
  reason: string;
  service?: string | null;
  category?: string | null;
  isHandoff?: boolean;
}

/** Upsert one normalized gap; increments counts on repeats. Never publishes anything. */
export async function recordKnowledgeGap(supabase: any, input: GapInput): Promise<void> {
  const key = normalizeQuestion(input.question);
  if (!key) return;
  try {
    const { data: existing } = await supabase
      .from("knowledge_gaps")
      .select("id, conversation_count, handoff_count")
      .eq("normalized_question", key)
      .maybeSingle();
    if (existing) {
      await supabase.from("knowledge_gaps").update({
        conversation_count: (existing.conversation_count ?? 0) + 1,
        handoff_count: (existing.handoff_count ?? 0) + (input.isHandoff ? 1 : 0),
        last_seen_at: new Date().toISOString(),
        example_wording: input.question.slice(0, 500),
        reason: input.reason,
      }).eq("id", existing.id);
    } else {
      await supabase.from("knowledge_gaps").insert({
        normalized_question: key,
        example_wording: input.question.slice(0, 500),
        service: input.service ?? null,
        category: input.category ?? null,
        handoff_count: input.isHandoff ? 1 : 0,
        reason: input.reason,
      });
    }
  } catch {
    // Gap tracking is best-effort; never break the conversation.
  }
}
