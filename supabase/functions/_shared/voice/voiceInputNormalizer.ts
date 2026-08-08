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
import { normalizeSpokenAddress } from "./spokenAddress.ts";

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
  lastAssistant: string,
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

  // Bare STT replies are safe to interpret only when the preceding assistant
  // prompt is explicitly selecting window sides. The returned customer-facing
  // phrasing is then consumed by the canonical intake/fact normalizers; this
  // module does not create a parallel sides enum or pricing contract.
  const asksWindowSides =
    /\bwindows?\b[^?.!]{0,100}\b(?:inside|outside|exterior|both|sides?|full service)\b|\b(?:inside|outside|exterior|both|sides?|full service)\b[^?.!]{0,100}\bwindows?\b/i
      .test(lastAssistant);
  if (asksWindowSides) {
    const trimmed = out.trim();
    if (
      /^(?:outside|exterior)(?:\s+only)?[.!?]?$/i.test(trimmed) ||
      // Exact incident recovery: Deepgram rendered "outside only" as
      // "household only". Interpret this homophone only while the immediately
      // preceding assistant turn is explicitly choosing window sides. The
      // same words remain untouched everywhere else.
      /^household(?:\s+only)?[.!?]?$/i.test(trimmed)
    ) {
      out = "exterior only";
      applied = true;
    } else if (
      /^(?:both|full service|inside and outside|inside and out|interior and exterior)$/i
        .test(trimmed)
    ) {
      out = "inside and outside";
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
  const sides = normalizeWindowSideShorthand(raw, lastAssistant);
  let text = sides.text;
  if (sides.applied) applied.push("window_sides");

  // Spoken address normalization runs FIRST: a digit-by-digit house number or
  // an explicit letter-by-letter street spelling must never be re-read as a
  // square-footage or story answer.
  const address = normalizeSpokenAddress(text, lastAssistant);
  if (address.applied.length) {
    return { text: address.text, applied: [...applied, ...address.applied] };
  }

  // Address-shaped answers are left completely alone.
  if (looksLikeAddress(text)) return { text, applied };

  if (
    askedSquareFootageQuestion(lastAssistant) && !HAS_EXPLICIT_SQFT.test(text)
  ) {
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
