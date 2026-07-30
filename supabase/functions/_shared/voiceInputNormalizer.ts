// ============================================================================
// voiceInputNormalizer.ts — deterministic cleanup for speech-to-text intake.
//
// Vapi/STT often returns short answers without the noun from the preceding
// question ("one", "two five zero zero"). The pricing parser expects explicit
// units. Normalize only the final user turn and only when the preceding
// assistant question makes the intended field unambiguous. This prevents a
// street number in an address from being mistaken for square footage.
// ============================================================================

import type {
  ChatMessage,
  ParsedAdapterRequest,
} from "./voiceAdapter.ts";

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  o: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

function cleanWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-,]/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Parse common spoken home sizes, including digit-by-digit STT output. */
export function parseSpokenSquareFootage(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  const numeric = trimmed.match(/^\s*([1-9][0-9]{2,4}|[1-9][0-9]?,[0-9]{3})\s*(?:sq\.?\s*ft\.?|square\s*feet|square\s*foot|sf)?\s*$/i);
  if (numeric) {
    const value = Number(numeric[1].replace(/,/g, ""));
    return value >= 300 && value <= 30000 ? value : null;
  }

  const words = cleanWords(trimmed).filter((word) =>
    !["about", "around", "roughly", "approximately", "square", "feet", "foot", "sf"].includes(word)
  );
  if (words.length === 0) return null;

  // STT frequently emits "two five zero zero" for 2500.
  if (words.length >= 3 && words.length <= 5 && words.every((word) => word in DIGIT_WORDS)) {
    const value = Number(words.map((word) => DIGIT_WORDS[word]).join(""));
    return value >= 300 && value <= 30000 ? value : null;
  }

  let total = 0;
  let current = 0;
  for (const word of words) {
    if (word in SMALL) {
      current += SMALL[word];
    } else if (word === "hundred") {
      current = Math.max(current, 1) * 100;
    } else if (word === "thousand") {
      total += Math.max(current, 1) * 1000;
      current = 0;
    } else {
      return null;
    }
  }
  const value = total + current;
  return value >= 300 && value <= 30000 ? value : null;
}

export function parseSpokenStories(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[-_]/g, " ");
  if (/^(?:1|one|single)(?:\s+(?:story|stories|storey|storeys|level|levels))?$/.test(t)) return 1;
  if (/^(?:2|two|double)(?:\s+(?:story|stories|storey|storeys|level|levels))?$/.test(t)) return 2;
  if (/^(?:3|three)(?:\s+(?:story|stories|storey|storeys|level|levels))?$/.test(t)) return 3;
  return null;
}

function asksForStories(text: string): boolean {
  return /\b(?:how many|one|two|three|number of)\b[^?.!]{0,35}\b(?:story|stories|storey|storeys|levels?)\b|\b(?:story|stories|storey|storeys|levels?)\b[^?.!]{0,35}\b(?:home|house|property|is it)\b/i.test(text);
}

function asksForSquareFootage(text: string): boolean {
  return /\b(?:square\s*(?:feet|foot|footage)|sq\.?\s*ft\.?|sf|how (?:large|big)|home size|property size)\b/i.test(text);
}

function normalizeWindowSides(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (/^(?:exterior|outside)(?:\s+only)?$/.test(t)) return "exterior only";
  if (/^(?:both|full service|inside and outside|inside and out|interior and exterior)$/.test(t)) {
    return "inside and outside";
  }
  return null;
}

export function normalizeVoiceUserTurn(
  userText: string,
  priorAssistantText: string,
): string {
  const original = userText.trim();
  if (!original) return userText;

  if (asksForStories(priorAssistantText)) {
    const stories = parseSpokenStories(original);
    if (stories) return `${stories} story`;
  }

  // Bare or spoken numbers are interpreted as square footage only when the
  // assistant explicitly asked for home size. A street number is therefore
  // left untouched during address collection.
  if (asksForSquareFootage(priorAssistantText)) {
    const sqft = parseSpokenSquareFootage(original);
    if (sqft) return `${sqft} square feet`;
  }

  const sides = normalizeWindowSides(original);
  if (sides && /\b(?:exterior|outside|inside|both|full service|window)\b/i.test(priorAssistantText)) {
    return sides;
  }

  return userText;
}

export function normalizeVoiceAdapterRequest(
  request: ParsedAdapterRequest,
): ParsedAdapterRequest {
  const messages: ChatMessage[] = request.messages.map((message) => ({ ...message }));
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return request;

  let priorAssistantText = "";
  for (let i = lastUserIndex - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      priorAssistantText = messages[i].content;
      break;
    }
  }

  messages[lastUserIndex].content = normalizeVoiceUserTurn(
    messages[lastUserIndex].content,
    priorAssistantText,
  );
  return { ...request, messages };
}
