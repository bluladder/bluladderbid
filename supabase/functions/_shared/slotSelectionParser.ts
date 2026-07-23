// ============================================================================
// slotSelectionParser.ts — pure, dependency-free parser for interpreting the
// customer's SMS reply against the SINGLE most-recent active option set.
//
// This module NEVER reserves, holds, books, or writes anything. It only turns
// free-form text into a structured selection intent. Callers decide what to do
// with an "ambiguous" or "no_match" result (typically: ask the customer to
// clarify) and what to do with "selected" (in a later phase: attempt a hold /
// booking through the authoritative engine).
// ============================================================================

export interface PresentedOption {
  option_number: number; // 1-based, matches how the customer sees it in SMS
  slot_id: string;       // opaque id from availabilityLookup
  start_at: string;      // ISO with tz offset
  end_at: string;        // ISO with tz offset
  timezone: string;      // IANA (e.g. "America/Chicago")
}

export type SelectionStatus =
  | "selected"
  | "ambiguous"
  | "no_match"
  | "expired_options";

export interface ParseResult {
  status: SelectionStatus;
  selected_slot_id: string | null;
  matched_option_number: number | null;
  clarification_message: string | null;
}

export interface ParseInput {
  /** Free-form customer text. */
  text: string;
  /** The presented options, in the order they were shown. */
  options: PresentedOption[];
  /** Set true when the presentation record has already expired or been
   *  superseded — the parser then returns `expired_options` regardless of
   *  what the customer typed. */
  expired?: boolean;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const WORD_NUMS: Record<string, number> = {
  // Only bare cardinal words. Ordinals (first/second/…) are handled by the
  // positional matcher. Cardinals REQUIRE an "option/opt/number/#" prefix
  // (see matchByNumber) to avoid false hits on filler like "the last one".
  one: 1, two: 2, three: 3, four: 4,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function normalize(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9:\s-]/g, " ").replace(/\s+/g, " ").trim();
}

function partsInTz(iso: string, timezone: string): { weekday: number; hour: number } {
  const d = new Date(iso);
  const wdName = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" })
    .format(d).toLowerCase();
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour12: false, hour: "2-digit",
  }).format(d);
  const hour = Number(hourStr.replace(/[^0-9]/g, ""));
  return { weekday: WEEKDAYS[wdName] ?? -1, hour: Number.isFinite(hour) ? hour : -1 };
}

// ---------------------------------------------------------------------------
// Individual matchers. Each returns the 1-based option numbers matched.
// ---------------------------------------------------------------------------

/** Explicit numeric selection: "1", "option 2", "#3", "number four". */
function matchByNumber(text: string, count: number): number[] {
  const t = " " + text + " ";
  // "option N" / "opt N" / "#N" / "number N"
  const explicit = t.match(/\b(?:option|opt|number|no|#)\s*#?\s*(\d{1,2})\b/);
  if (explicit) {
    const n = Number(explicit[1]);
    if (n >= 1 && n <= count) return [n];
  }
  // Word number ONLY when explicitly prefixed ("option one", "number two").
  const wordExplicit = t.match(/\b(?:option|opt|number|no|#)\s+(one|two|three|four)\b/);
  if (wordExplicit) {
    const n = WORD_NUMS[wordExplicit[1]];
    if (n && n <= count) return [n];
  }
  // Bare digit BUT only if it looks like a standalone selection (avoids eating
  // hours in "10 to 12"). Require: single 1-digit token AND no adjacent "to/-/:".
  const bare = t.match(/(^|\s)(\d)($|\s)/);
  if (bare && !/\d\s*(to|-|:)\s*\d/.test(t)) {
    const n = Number(bare[2]);
    if (n >= 1 && n <= count) return [n];
  }
  return [];
}

/** Positional selection: "the first one", "the last option", "the middle one". */
function matchByPosition(text: string, count: number): number[] {
  if (/\blast\b/.test(text)) return [count];
  if (/\bfirst\b/.test(text)) return [1];
  if (/\bsecond\b/.test(text) && count >= 2) return [2];
  if (/\bthird\b/.test(text) && count >= 3) return [3];
  if (/\bmiddle\b/.test(text) && count === 3) return [2];
  return [];
}

/** Weekday + optional time-of-day: "Friday", "Friday morning", "Mon afternoon". */
function matchByWeekday(text: string, options: PresentedOption[]): number[] {
  let wd = -1;
  for (const [name, n] of Object.entries(WEEKDAYS)) {
    if (new RegExp(`\\b${name}\\b`).test(text)) { wd = n; break; }
  }
  if (wd < 0) return [];
  const wantMorning = /\bmorning\b|\bam\b/.test(text);
  const wantAfternoon = /\bafternoon\b|\bpm\b|\bevening\b/.test(text);
  const matches: number[] = [];
  for (const o of options) {
    const { weekday, hour } = partsInTz(o.start_at, o.timezone);
    if (weekday !== wd) continue;
    if (wantMorning && !(hour < 12)) continue;
    if (wantAfternoon && !(hour >= 12)) continue;
    matches.push(o.option_number);
  }
  return matches;
}

/** Explicit time range: "the 10 to 12 one", "10-12", "8 to 10". */
function matchByTimeRange(text: string, options: PresentedOption[]): number[] {
  const m = text.match(/\b(\d{1,2})(?::\d{2})?\s*(?:to|-|through|until)\s*(\d{1,2})(?::\d{2})?\b/);
  if (!m) return [];
  let startH = Number(m[1]);
  let endH = Number(m[2]);
  if (!(startH >= 1 && startH <= 23 && endH >= 1 && endH <= 23)) return [];
  const matches: number[] = [];
  for (const o of options) {
    const { hour: sh } = partsInTz(o.start_at, o.timezone);
    const { hour: eh } = partsInTz(o.end_at, o.timezone);
    const shMod = sh % 12 === 0 ? 12 : sh % 12;
    const ehMod = eh % 12 === 0 ? 12 : eh % 12;
    if ((sh === startH && eh === endH) || (shMod === startH && ehMod === endH)) {
      matches.push(o.option_number);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function parseSlotSelection(input: ParseInput): ParseResult {
  if (input.expired) {
    return {
      status: "expired_options",
      selected_slot_id: null,
      matched_option_number: null,
      clarification_message:
        "Those times are no longer current — let me pull fresh availability and share updated options.",
    };
  }
  const options = input.options ?? [];
  if (options.length === 0) {
    return {
      status: "expired_options",
      selected_slot_id: null,
      matched_option_number: null,
      clarification_message:
        "I don't have any active options for this conversation — let me pull fresh availability.",
    };
  }
  const text = normalize(input.text ?? "");
  if (!text) {
    return {
      status: "no_match",
      selected_slot_id: null,
      matched_option_number: null,
      clarification_message:
        "Could you reply with the option number (1, 2, or 3) or say something like 'Friday morning'?",
    };
  }

  // Run matchers in a deterministic order and union results (deduped).
  const hits = new Set<number>();
  for (const m of [
    matchByNumber(text, options.length),
    matchByPosition(text, options.length),
    matchByTimeRange(text, options),
    matchByWeekday(text, options),
  ]) {
    for (const n of m) hits.add(n);
  }

  const list = [...hits].sort((a, b) => a - b);
  if (list.length === 1) {
    const picked = options.find((o) => o.option_number === list[0])!;
    return {
      status: "selected",
      selected_slot_id: picked.slot_id,
      matched_option_number: picked.option_number,
      clarification_message: null,
    };
  }
  if (list.length === 0) {
    return {
      status: "no_match",
      selected_slot_id: null,
      matched_option_number: null,
      clarification_message:
        "I couldn't tell which time you meant — reply with the option number (1, 2, or 3) or a day like 'Friday morning'.",
    };
  }
  return {
    status: "ambiguous",
    selected_slot_id: null,
    matched_option_number: null,
    clarification_message:
      `That could match more than one option (${list.join(", ")}). Which one would you like — reply with the number?`,
  };
}