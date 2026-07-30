// ============================================================================
// spokenAddress.ts — deterministic normalization of SPOKEN addresses.
//
// Incident 019fb51e: the caller said
//   "Five six one two Branch Lane. B I N B R A N C H, McKinney, Texas 75071"
// and the assistant kept using "Branch Lane" because neither the spoken digit
// house number nor the explicit letter-by-letter spelling was understood.
//
// This module is PURE and runs before any routing. It never fuzzy-guesses a
// word that was not explicitly spelled: it only (a) converts a spoken
// digit-by-digit house number to digits and (b) collapses an explicit
// letter-by-letter spelling into a single word, which is then authoritative
// over the ASR's guess for the street name.
// ============================================================================

const DIGIT_WORDS: Record<string, string> = {
  zero: "0",
  oh: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  niner: "9",
};

const SUFFIXES = new Set([
  "lane",
  "ln",
  "street",
  "st",
  "drive",
  "dr",
  "road",
  "rd",
  "avenue",
  "ave",
  "court",
  "ct",
  "circle",
  "cir",
  "boulevard",
  "blvd",
  "way",
  "trail",
  "trl",
  "place",
  "pl",
  "terrace",
  "ter",
  "parkway",
  "pkwy",
  "highway",
  "hwy",
]);

export interface SpokenAddressNormalization {
  text: string;
  applied: string[];
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();

/** True when the assistant's last turn asked for a street spelling. */
export function askedForSpelling(lastAssistant: string | null): boolean {
  if (!lastAssistant) return false;
  return /\bspell\b|\bspelling\b|letter by letter/i.test(lastAssistant);
}

/** True when the assistant's last turn asked for the address / house number. */
export function askedForAddress(lastAssistant: string | null): boolean {
  if (!lastAssistant) return false;
  return /\b(address|house number|street number|street address|zip)\b/i
    .test(lastAssistant);
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Collapse runs of >= 3 single spoken letters into one capitalized word. */
export function collapseSpelledWords(
  text: string,
): { text: string; spelled: string[] } {
  const spelled: string[] = [];
  const out = text.replace(
    /\b(?:[A-Za-z][.\-]?[ ,]+){2,}[A-Za-z]\b/g,
    (match) => {
      const letters = match.match(/[A-Za-z]/g) ?? [];
      if (letters.length < 3) return match;
      const word = titleCase(letters.join(""));
      spelled.push(word);
      return word;
    },
  );
  return { text: out, spelled };
}

/** Convert a leading run of >= 2 spoken digits into a numeric house number. */
function spokenDigitsToNumber(tokens: string[]): string | null {
  const digits: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase().replace(/[^a-z]/g, "");
    const d = DIGIT_WORDS[key];
    if (d === undefined) break;
    digits.push(d);
  }
  return digits.length >= 2 ? digits.join("") : null;
}

function segments(text: string): string[] {
  return text.split(/[,.]/).map((s) => clean(s)).filter(Boolean);
}

interface StreetParts {
  houseNumber: string | null;
  suffix: string | null;
  tail: string;
}

/** Pull the house number, street suffix and city/state/zip tail out of text. */
export function extractStreetParts(text: string): StreetParts {
  const segs = segments(text);
  let houseNumber: string | null = null;
  let suffix: string | null = null;
  let streetIdx = -1;
  for (let i = 0; i < segs.length; i++) {
    const words = segs[i].split(" ");
    const numIdx = words.findIndex((w) => /^\d{1,6}$/.test(w));
    const numeric = numIdx >= 0 ? words[numIdx] : null;
    const spoken = numeric ? null : spokenDigitsToNumber(words);
    const last = words[words.length - 1]?.toLowerCase().replace(/[^a-z]/g, "");
    if ((numeric || spoken) && last && SUFFIXES.has(last)) {
      houseNumber = numeric ?? spoken;
      suffix = titleCase(words[words.length - 1].replace(/[^A-Za-z]/g, ""));
      streetIdx = i;
      break;
    }
  }
  const tail = streetIdx >= 0 ? segs.slice(streetIdx + 1).join(", ") : "";
  return { houseNumber, suffix, tail };
}

/**
 * Normalize one spoken utterance into an unambiguous address string.
 * Returns the input unchanged when nothing address-specific applies.
 */
export function normalizeSpokenAddress(
  utterance: string,
  lastAssistant: string | null = null,
): SpokenAddressNormalization {
  const applied: string[] = [];
  const raw = clean(String(utterance ?? ""));
  if (!raw) return { text: String(utterance ?? ""), applied };

  const collapsed = collapseSpelledWords(raw);
  let text = collapsed.text;
  if (collapsed.spelled.length) applied.push("spelled_street");

  const segs = segments(text);
  const spelledOnlyIdx = collapsed.spelled.length
    ? segs.findIndex((s) => s === collapsed.spelled[0])
    : -1;

  const parts = extractStreetParts(text);

  // Case 1: caller gave the house number and the suffix in the same utterance.
  if (parts.houseNumber && parts.suffix) {
    if (collapsed.spelled.length && spelledOnlyIdx >= 0) {
      // Explicit spelling wins over the ASR guess for the street name.
      const rest = segs
        .filter((_s, i) => i !== spelledOnlyIdx)
        .slice(1)
        .join(", ");
      text = clean(
        `${parts.houseNumber} ${collapsed.spelled[0]} ${parts.suffix}` +
          (rest ? `, ${rest}` : ""),
      );
      applied.push("spoken_house_number", "spelling_authoritative");
      return { text, applied };
    }
    if (!/^\d/.test(segs[0] ?? "")) {
      const rebuilt = segs.slice(1).join(", ");
      const streetWords = (segs[0] ?? "").split(" ");
      const spokenLen = streetWords.findIndex((w) =>
        DIGIT_WORDS[w.toLowerCase().replace(/[^a-z]/g, "")] === undefined
      );
      const name = streetWords.slice(spokenLen < 0 ? 0 : spokenLen).join(" ");
      text = clean(
        `${parts.houseNumber} ${name}` + (rebuilt ? `, ${rebuilt}` : ""),
      );
      applied.push("spoken_house_number");
      return { text, applied };
    }
    return { text, applied };
  }

  // Case 2: caller spelled ONLY the street name after a spelling prompt —
  // combine it with the house number/suffix/city from the assistant readback.
  if (
    collapsed.spelled.length && !parts.houseNumber &&
    (askedForSpelling(lastAssistant) || askedForAddress(lastAssistant))
  ) {
    const prior = extractStreetParts(String(lastAssistant ?? ""));
    if (prior.houseNumber && prior.suffix) {
      text = clean(
        `${prior.houseNumber} ${collapsed.spelled[0]} ${prior.suffix}` +
          (prior.tail ? `, ${prior.tail}` : ""),
      );
      applied.push("spelling_from_readback");
      return { text, applied };
    }
  }

  // Case 3: a bare spoken number answering an address / house-number question.
  if (askedForAddress(lastAssistant)) {
    const spoken = spokenDigitsToNumber(text.split(" "));
    if (spoken && spoken.length >= 3) {
      applied.push("spoken_house_number");
      return { text: spoken, applied };
    }
  }

  return { text, applied };
}
