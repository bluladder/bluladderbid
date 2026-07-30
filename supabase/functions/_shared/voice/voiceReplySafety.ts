// ============================================================================
// voiceReplySafety.ts — VOICE-ONLY spoken reply sanitizer.
//
// Incident 019fb51e leaked model reasoning verbatim to the caller:
//   "thought Okay, I need `squareFootage` and `stories` for the window
//    cleaning quote. Let me ask the user for these details."
// and asked two intake questions in a single turn.
//
// Every model-authored spoken reply passes through here. Leaked reasoning is
// never spoken: it is replaced by the deterministic next question derived from
// current facts. At most one customer question is spoken per turn.
// ============================================================================
import type { ConversationFacts } from "../conversationState.ts";

const REASONING_MARKERS: RegExp[] = [
  /^\s*(?:thought|thinking|analysis|reasoning|assistantfinal)\b/i,
  /\blet me ask the user\b/i,
  /\bI need to (?:call|use) the .*tool\b/i,
  /\b(?:tool_call|function_call|system prompt|<thinking)\b/i,
  /`[A-Za-z_][A-Za-z0-9_]*`/,
  /\bI need `?[A-Za-z_]+`? and `?[A-Za-z_]+`?\b/i,
];

export function containsInternalReasoning(text: string): boolean {
  const t = String(text ?? "");
  return REASONING_MARKERS.some((re) => re.test(t));
}

/** The single next intake question, one field at a time. */
export function nextPropertyQuestion(facts: ConversationFacts): string {
  const p = facts.property ?? {};
  const services = facts.services ?? [];
  if (!p.squareFootage) {
    return "About how many square feet is your home?";
  }
  if (services.includes("window_cleaning") && !p.windowCleaningType) {
    return "Would you like the windows cleaned inside and outside, or exterior only?";
  }
  if (!p.stories) {
    return "How many stories is your home?";
  }
  return "What else can I help you with?";
}

/** Keep only the first question so a turn never stacks two asks. */
export function enforceSingleQuestion(text: string): string {
  const t = String(text ?? "").trim();
  const marks = (t.match(/\?/g) ?? []).length;
  if (marks < 2) return t;
  const idx = t.indexOf("?");
  return t.slice(0, idx + 1).trim();
}

export interface VoiceReplySanitization {
  text: string;
  applied: string[];
}

export function sanitizeVoiceReply(
  reply: string,
  fallback: string,
): VoiceReplySanitization {
  const applied: string[] = [];
  let text = String(reply ?? "").trim();
  if (!text || containsInternalReasoning(text)) {
    applied.push("internal_reasoning_suppressed");
    return { text: fallback, applied };
  }
  const single = enforceSingleQuestion(text);
  if (single !== text) {
    applied.push("single_question");
    text = single;
  }
  return { text, applied };
}
