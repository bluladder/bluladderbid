// ============================================================================
// factExtractor.ts — LLM-assisted structured extraction from utterance.
//
// The controller calls this once per turn. Returns ONLY a QuoteSessionFields
// patch; sequencing decisions live in the controller. Uses strict JSON output
// and validates every field before returning; unknown values are dropped.
// ============================================================================
//
// TODO(workflow-router-v1 turn B): wire to Lovable AI Gateway with strict
// json_schema output. This scaffold declares the contract so the controller
// and its tests can be written first without waiting on the model call.
// ============================================================================

import type { QuoteSessionFields } from "../quoteSession.ts";

export interface ExtractorInput {
  utterance: string;
  history: { role: "user" | "assistant"; content: string }[];
  currentFields: QuoteSessionFields;
}

export interface ExtractorResult {
  patch: Partial<QuoteSessionFields>;
  confidence: Partial<Record<keyof QuoteSessionFields, number>>;
  ambiguities: string[];
}

/** Deterministic fallback used until the model call is wired in turn B.
 *  Recognizes the narrow set of facts the residential-window FSM needs so the
 *  controller can be tested end-to-end without a live model. */
export function extractFactsHeuristic(input: ExtractorInput): ExtractorResult {
  const u = input.utterance.toLowerCase();
  const patch: Partial<QuoteSessionFields> = {};
  const conf: Partial<Record<keyof QuoteSessionFields, number>> = {};

  if (/window\s*(clean|wash)|windows?\s+(cleaned|washed)/.test(u)) {
    patch.services = ["windowCleaning"];
    conf.services = 0.9;
  }
  const sqft = u.match(/(\d{3,5})\s*(square\s*feet|sq\.?\s*ft|sqft|sf)\b/);
  if (sqft) { patch.squareFootage = Number(sqft[1]); conf.squareFootage = 0.95; }
  const stories = u.match(/\b(one|two|three|1|2|3)[-\s]?(story|stories|storey|storeys)\b/);
  if (stories) {
    const n = { one: 1, two: 2, three: 3 }[stories[1]] ?? Number(stories[1]);
    patch.stories = n; conf.stories = 0.9;
  }
  if (/inside\s+and\s+out|both\s+sides|full\s+service|interior\s+and\s+exterior/.test(u)) {
    patch.windowCleaningSides = "inside_and_outside"; conf.windowCleaningSides = 0.9;
  } else if (/(outside|exterior)\s*(only|glass)?|just\s+the\s+outside/.test(u)) {
    patch.windowCleaningSides = "outside_only"; conf.windowCleaningSides = 0.9;
  }

  const condition = normalizeWindowCondition(input.utterance);
  if (condition) { patch.condition = condition; conf.condition = 0.9; }

  return { patch, confidence: conf, ambiguities: [] };
}

/**
 * Normalize a spoken window-condition answer into the canonical pricing value
 * used by the web booking flow and the canonical pricing engine
 * (`homeDetails.condition`). Only two canonical categories exist today:
 *   - "maintenance" — regular / recently cleaned
 *   - "heavy"       — first-time, noticeably dirty, or heavy buildup
 * Both "noticeably dirty" and "heavily soiled" collapse to "heavy" to match
 * the modifier value the engine already stores.
 */
export function normalizeWindowCondition(raw: string): "maintenance" | "heavy" | null {
  const s = raw.toLowerCase();
  if (/(regular(ly)?\s*maintain|well\s*maintain|recently\s*clean|clean(ed)?\s*(recently|within|last\s*year)|maintenance|not\s*(too\s*)?(bad|dirty)|pretty\s*clean)/.test(s)) {
    return "maintenance";
  }
  if (/(heav(y|ily)|first[-\s]?time|never\s*been\s*clean|hasn'?t\s*been\s*clean|really\s*dirty|very\s*dirty|noticeably\s*dirty|significant\s*buildup|lots?\s*of\s*buildup|caked|filthy|neglected|a\s*while)/.test(s)) {
    return "heavy";
  }
  return null;
}
