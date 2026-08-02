// Deterministic, context-safe quantity parsing for voice intake.
//
// The parser recognizes ordinary spoken quantities without interpreting an
// address, phone number, or unrelated sentence as a service measurement.
// Field-specific bounds remain the responsibility of the canonical intake
// caller.

const DIGITS: Readonly<Record<string, number>> = {
  zero: 0,
  oh: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

const TENS: Readonly<Record<string, number>> = {
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

const NUMBER_WORDS = new Set([
  ...Object.keys(DIGITS),
  ...Object.keys(TENS),
  "hundred",
  "thousand",
  "and",
  "a",
  "half",
  "point",
]);

function tokensFor(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/[^a-z0-9.\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

function parseIntegerWords(words: string[]): number | undefined {
  if (words.length === 0) return undefined;

  const digitByDigit = words.length >= 3 && words.length <= 6 &&
    words.every((word) => word in DIGITS || /^[0-9]$/.test(word));
  if (digitByDigit) {
    const value = Number(
      words.map((word) => /^[0-9]$/.test(word) ? word : DIGITS[word]).join(""),
    );
    return Number.isFinite(value) ? value : undefined;
  }

  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const word of words) {
    if (word === "and") continue;
    if (word in DIGITS) {
      current += DIGITS[word];
      sawNumber = true;
      continue;
    }
    if (word in TENS) {
      current += TENS[word];
      sawNumber = true;
      continue;
    }
    if (word === "hundred") {
      current = (current || 1) * 100;
      sawNumber = true;
      continue;
    }
    if (word === "thousand") {
      total += (current || 1) * 1000;
      current = 0;
      sawNumber = true;
      continue;
    }
    return undefined;
  }
  return sawNumber ? total + current : undefined;
}

/**
 * Convert a clean numeric phrase to a number. This preserves the established
 * square-footage behavior while adding normal fractions used by window
 * equivalents.
 */
export function spokenToNumber(text: string): number | undefined {
  const normalized = (text ?? "").trim().toLowerCase().replaceAll(",", "");
  if (!normalized) return undefined;

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    const value = Number(normalized);
    return Number.isFinite(value) ? value : undefined;
  }

  const words = tokensFor(normalized);
  if (words.length === 0) return undefined;

  if (words.length === 1 && words[0] === "half") return 0.5;

  const halfSuffix = words.length >= 3 &&
    words.at(-1) === "half" &&
    (words.at(-2) === "a" || words.at(-2) === "one") &&
    words.at(-3) === "and";
  if (halfSuffix) {
    const whole = parseIntegerWords(words.slice(0, -3));
    return whole === undefined ? undefined : whole + 0.5;
  }

  const pointIndex = words.indexOf("point");
  if (pointIndex >= 0) {
    if (words.indexOf("point", pointIndex + 1) >= 0) return undefined;
    const whole = parseIntegerWords(words.slice(0, pointIndex));
    const decimals = words.slice(pointIndex + 1);
    if (
      whole === undefined || decimals.length === 0 ||
      !decimals.every((word) => word in DIGITS || /^[0-9]$/.test(word))
    ) return undefined;
    const digits = decimals.map((word) =>
      /^[0-9]$/.test(word) ? word : String(DIGITS[word])
    ).join("");
    const value = Number(`${whole}.${digits}`);
    return Number.isFinite(value) ? value : undefined;
  }

  return parseIntegerWords(words);
}

function looksLikeAddressOrContact(text: string): boolean {
  const value = (text ?? "").toLowerCase();
  if (
    /\b(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|parkway|pkwy|highway|hwy|trail|trl|circle|cir)\b/
      .test(value)
  ) return true;
  if (/\b[a-z]{2}\s+\d{5}(?:-\d{4})?\b/.test(value)) return true;
  if (/\b(?:phone|telephone|mobile|zip|postal|address)\b/.test(value)) {
    return true;
  }
  return false;
}

export interface SpokenQuantityOptions {
  min?: number;
  max?: number;
  integer?: boolean;
  step?: number;
}

/**
 * Extract one unambiguous quantity from a natural voice answer.
 *
 * "There are two windows" -> 2
 * "two and a half" -> 2.5
 * "one or two" -> undefined
 */
export function parseSpokenQuantity(
  text: string,
  options: SpokenQuantityOptions = {},
): number | undefined {
  if (!text?.trim() || looksLikeAddressOrContact(text)) return undefined;

  const candidates: number[] = [];
  const numericMatches = text.replaceAll(",", "").matchAll(
    /\b\d+(?:\.\d+)?\b/g,
  );
  for (const match of numericMatches) {
    const value = Number(match[0]);
    if (Number.isFinite(value)) candidates.push(value);
  }

  const words = tokensFor(text);
  let span: string[] = [];
  const flush = () => {
    if (span.length === 0) return;
    const value = spokenToNumber(span.join(" "));
    if (value !== undefined) candidates.push(value);
    span = [];
  };
  for (const word of words) {
    if (NUMBER_WORDS.has(word) || /^\d+(?:\.\d+)?$/.test(word)) {
      span.push(word);
    } else {
      flush();
    }
  }
  flush();

  const distinct = [...new Set(candidates.map((value) => value.toFixed(6)))]
    .map(Number);
  if (distinct.length !== 1) return undefined;

  const value = distinct[0];
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value) || value < min || value > max) return undefined;
  if (options.integer && !Number.isInteger(value)) return undefined;
  if (
    options.step &&
    Math.abs(value / options.step - Math.round(value / options.step)) > 1e-9
  ) return undefined;
  return value;
}
