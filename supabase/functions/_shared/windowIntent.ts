// ============================================================================
// windowIntent.ts — Phase 4C-β.4A
//
// Pure classifier + terminology normalizer for window-cleaning requests.
// Distinguishes:
//   - residential_whole_home  → existing canonical whole-home engine path
//   - residential_partial     → canonical partial-window per-side pricing
//   - commercial_custom_bid   → structured intake, no automated price
//
// Terminology normalization is SCOPED to window cleaning: "outside only" /
// "exterior only" / "outside glass only" / "just the outsides" only normalize
// to `outside_only` when the active service is windowCleaning. Never
// interpret "exterior only" globally.
//
// Zero external imports. Deno-testable.
// ============================================================================

export type CustomerType = "residential" | "commercial" | "unknown";
export type WindowCleaningScope =
  | "whole_home"
  | "partial"
  | "commercial_custom"
  | "unknown";
export type WindowCleaningSides = "outside_only" | "inside_and_outside";

export interface WindowIntentPatch {
  customerType?: CustomerType;
  windowCleaningScope?: WindowCleaningScope;
  windowCleaningSides?: WindowCleaningSides;
  windowCount?: number;
  partialAreas?: string[];
  commercialPropertyType?: string;
  commercialSignals?: string[];
}

export interface ClassifyContext {
  activeServices?: string[];
  priorScope?: WindowCleaningScope;
  priorSides?: WindowCleaningSides;
}

const COMMERCIAL_KEYWORDS = [
  "storefront",
  "retail shop",
  "retail store",
  "office building",
  "office",
  "restaurant",
  "church",
  "school",
  "warehouse",
  "apartment common area",
  "apartment complex",
  "hoa",
  "property management",
  "property-management",
  "commercial",
  "business location",
  "dental office",
  "medical office",
  "clinic",
  "shop",
];

const PARTIAL_MARKERS = [
  /\bonly\b/i,
  /\bjust\b/i,
  /\ba few\b/i,
  /\bcertain\b/i,
  /\bspecific\b/i,
  /\bproblem window/i,
  /\bfront window/i,
  /\bback window/i,
  /\bpatio\b/i,
  /\bliving[- ]room\b/i,
  /\bupstairs\b/i,
  /\bdownstairs\b/i,
  /\bdon'?t want (?:my )?whole (?:house|home)\b/i,
  /\bnot the whole (?:house|home)\b/i,
];

const WHOLE_HOME_MARKERS = [
  /\bwhole (?:house|home)\b/i,
  /\ball (?:my|the) windows\b/i,
  /\bevery window\b/i,
  /\bentire (?:house|home)\b/i,
  /\bfull (?:house|home)\b/i,
];

const OUTSIDE_ONLY_PHRASES = [
  /\boutside(?: surfaces| glass)? only\b/i,
  /\bexterior(?: glass| surfaces)? only\b/i,
  /\bjust the outsides?\b/i,
  /\boutsides? only\b/i,
  /\bexteriors? only\b/i,
];

const INSIDE_AND_OUTSIDE_PHRASES = [
  /\binside and outside\b/i,
  /\boutside and inside\b/i,
  /\binterior and exterior\b/i,
  /\bexterior and interior\b/i,
  /\bboth sides\b/i,
  /\bfull service\b/i,
  /\bin(?:side)? and out(?:side)?\b/i,
];

/** Normalize an outside/inside-and-outside phrase, ONLY when window cleaning
 *  is an active service. Returns null if not applicable. */
export function normalizeWindowSides(
  utterance: string,
  ctx: ClassifyContext,
): WindowCleaningSides | null {
  if (!isWindowServiceActive(ctx)) return null;
  for (const rx of INSIDE_AND_OUTSIDE_PHRASES) if (rx.test(utterance)) return "inside_and_outside";
  for (const rx of OUTSIDE_ONLY_PHRASES) if (rx.test(utterance)) return "outside_only";
  return null;
}

export function isWindowServiceActive(ctx: ClassifyContext): boolean {
  return (ctx.activeServices ?? []).includes("windowCleaning");
}

function detectWindowCount(u: string): number | null {
  const digit = u.match(/\b(\d{1,3})\s+windows?\b/i);
  if (digit) {
    const n = parseInt(digit[1], 10);
    if (n > 0 && n < 500) return n;
  }
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12,
  };
  for (const [w, n] of Object.entries(words)) {
    const rx = new RegExp(`\\b${w}\\s+windows?\\b`, "i");
    if (rx.test(u)) return n;
  }
  return null;
}

function detectPartialAreas(u: string): string[] {
  const areas: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\bfront\b/i, "front"],
    [/\bback\b/i, "back"],
    [/\bside\b/i, "side"],
    [/\bupstairs\b/i, "upstairs"],
    [/\bdownstairs\b/i, "downstairs"],
    [/\bpatio\b/i, "patio"],
    [/\bliving[- ]room\b/i, "living_room"],
    [/\bkitchen\b/i, "kitchen"],
    [/\bbedroom\b/i, "bedroom"],
    [/\bmaster\b/i, "master"],
  ];
  for (const [rx, tag] of patterns) if (rx.test(u)) areas.push(tag);
  return areas;
}

function detectCommercial(u: string): { hit: boolean; matched: string[]; type?: string } {
  const low = u.toLowerCase();
  const matched: string[] = [];
  for (const kw of COMMERCIAL_KEYWORDS) {
    if (low.includes(kw)) matched.push(kw);
  }
  const type = matched[0];
  return { hit: matched.length > 0, matched, type };
}

function anyMatch(u: string, patterns: RegExp[]): boolean {
  return patterns.some((rx) => rx.test(u));
}

/** Classify a single customer utterance in the context of prior facts.
 *  Returns only fields that were confidently inferred from THIS utterance.
 *  Prior facts should not be overwritten by this function alone; merge them
 *  through the Quote Session so status transitions are tracked. */
export function classifyWindowIntent(
  utterance: string,
  ctx: ClassifyContext = {},
): WindowIntentPatch {
  const patch: WindowIntentPatch = {};
  const u = utterance || "";

  const commercial = detectCommercial(u);
  if (commercial.hit) {
    patch.customerType = "commercial";
    patch.windowCleaningScope = "commercial_custom";
    if (commercial.type) patch.commercialPropertyType = commercial.type;
    patch.commercialSignals = commercial.matched;
  }

  const sides = normalizeWindowSides(u, ctx);
  if (sides) patch.windowCleaningSides = sides;

  // Only classify residential scope when commercial did not match.
  if (!commercial.hit) {
    const isPartial = anyMatch(u, PARTIAL_MARKERS);
    const isWhole = anyMatch(u, WHOLE_HOME_MARKERS);
    if (isPartial && !isWhole) {
      patch.customerType = patch.customerType ?? "residential";
      patch.windowCleaningScope = "partial";
      const count = detectWindowCount(u);
      if (count) patch.windowCount = count;
      const areas = detectPartialAreas(u);
      if (areas.length) patch.partialAreas = areas;
    } else if (isWhole && !isPartial) {
      patch.customerType = patch.customerType ?? "residential";
      patch.windowCleaningScope = "whole_home";
    }
  }

  return patch;
}

/** True when scope classification is ambiguous and the assistant should ask:
 *  "Are you looking to have most or all of the windows cleaned, or only
 *  certain windows or areas?" */
export function needsScopeClarification(
  activeServices: string[] | undefined,
  currentScope: WindowCleaningScope | undefined,
): boolean {
  if (!(activeServices ?? []).includes("windowCleaning")) return false;
  return !currentScope || currentScope === "unknown";
}

/** Canonical window-cleaning question wording. Never ambiguous "exterior
 *  only?"—always names the service explicitly. */
export const WINDOW_SIDES_QUESTION =
  "For the window cleaning, do you want the outside surfaces only, or both inside and outside?";

export const WINDOW_SCOPE_QUESTION =
  "Are you looking to have most or all of the windows cleaned, or only certain windows or areas?";

export const COMMERCIAL_HANDOFF_LINE =
  "Thanks. I've saved the scope and locations. We'll prepare a custom bid, and Ben will reach out with the price. What is the best way to contact you: text, email or a phone call?";

export const PARTIAL_PRICING_QUALIFIER =
  "For smaller window-cleaning jobs, we can estimate them at $10 per window side. That would be $10 per window for outside-only cleaning, or $20 per window for both inside and outside.";