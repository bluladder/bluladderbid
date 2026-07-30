// ============================================================================
// voiceInputNormalizer.ts — pre-routing normalization of voice utterances.
//
// Integrated from PR #60 (branch agent/voice-conversation-hardening) onto the
// safety-remediated main. The normalizer runs BEFORE both the deterministic
// workflow controller and the legacy orchestrator so a bare voice answer
// ("one", "two five zero zero", "outside only") means the same thing to both
// lanes.
//
// Deliberate overlap resolution: this module does NOT re-implement parsing.
// It reuses the context-aware parsers already hardened on main
// (aiOrchestrator) so there is exactly one source of truth for story counts,
// spoken square footage and address-safe numeric handling. The normalizer only
// rewrites the utterance into an explicit, unambiguous phrasing.
// ============================================================================
import {
  askedSquareFootageQuestion,
  askedStoriesQuestion,
  lastAssistantQuestion,
  looksLikeAddress,
  parseSquareFootage,
  parseStories,
} from "../aiOrchestrator.ts";

export type VoiceTurn = { role: "user" | "assistant"; content: string };

export type VoiceInputNormalization = {
  /** The utterance to route to the controller / legacy orchestrator. */
  text: string;
  /** Normalizations that were applied, for telemetry and tests. */
  applied: string[];
};

const HAS_EXPLICIT_SQFT =
  /\b(?:sq\.?\s*ft\.?|square\s*(?:feet|foot|footage)|sf)\b/i;
const HAS_EXPLICIT_STORIES = /\b(?:stor(?:y|ies|ey|eys)|level|levels)\b/i;

/** Window-side shorthand → the canonical phrasing the parsers key on. */
function normalizeWindowSideShorthand(
  text: string,
): { text: string; applied: boolean } {
  let out = text;
  let applied = false;
  const rules: [RegExp, string][] = [
    [/\b(?:just|only)\s+(?:the\s+)?out(?:side|sides|s)\b/gi, "exterior only"],
    [/\bout(?:side|sides)\s+only\b/gi, "exterior only"],
    [/\bexteriors?\s+only\b/gi, "exterior only"],
    [/\bin\s*and\s*out\b/gi, "inside and outside"],
    [/\bboth\s+sides\b/gi, "inside and outside"],
  ];
  for (const [re, replacement] of rules) {
    if (re.test(out)) {
      out = out.replace(re, replacement);
      applied = true;
    }
  }
  return { text: out, applied };
}

/**
 * Normalize one caller utterance using the immediately preceding assistant
 * question as context. Address-shaped replies are never rewritten — the house
 * number must never be promoted into a square-footage or story answer
 * (incident 019fb423).
 */
export function normalizeVoiceInput(
  utterance: string,
  history: VoiceTurn[] = [],
): VoiceInputNormalization {
  const raw = (utterance ?? "").toString();
  const applied: string[] = [];
  if (!raw.trim()) return { text: raw, applied };

  const lastAssistant = lastAssistantQuestion(history ?? []);
  const sides = normalizeWindowSideShorthand(raw);
  let text = sides.text;
  if (sides.applied) applied.push("window_sides");

  // Address-shaped answers are left completely alone.
  if (looksLikeAddress(text)) return { text, applied };

  if (askedSquareFootageQuestion(lastAssistant) && !HAS_EXPLICIT_SQFT.test(text)) {
    const sqft = parseSquareFootage(text, { askedSquareFootage: true });
    if (sqft) {
      text = `${text.trim()} (${sqft} square feet)`;
      applied.push("square_footage");
    }
  }

  if (askedStoriesQuestion(lastAssistant) && !HAS_EXPLICIT_STORIES.test(text)) {
    const stories = parseStories(text, { askedStories: true });
    if (stories) {
      text = `${text.trim()} (${stories} story)`;
      applied.push("stories");
    }
  }

  return { text, applied };
}

/**
 * Apply the normalizer to an OpenAI-compatible message array in place of the
 * last user message. Returns a new array; the input is not mutated.
 */
export function normalizeVoiceMessages<
  T extends { role: string; content: string },
>(messages: T[]): { messages: T[]; applied: string[] } {
  const list = [...(messages ?? [])];
  let lastUserIdx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx < 0) return { messages: list, applied: [] };

  const history = list
    .slice(0, lastUserIdx)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const result = normalizeVoiceInput(list[lastUserIdx].content, history);
  if (!result.applied.length) return { messages: list, applied: [] };
  list[lastUserIdx] = { ...list[lastUserIdx], content: result.text };
  return { messages: list, applied: result.applied };
}
