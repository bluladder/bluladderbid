// ============================================================================
// partialWindowPricing.ts — Canonical partial-window pricing rule (Phase 4C-β.4A)
//
// Rule: partialWindowPrice = windowCount × cleanedSides × $10
//   outside_only      → cleanedSides = 1
//   inside_and_outside → cleanedSides = 2
//
// This is the ONLY authorized source for partial-window prices. It must NEVER
// be duplicated in a Vapi prompt or an untracked constant. Applied only when
// windowCleaningScope === "partial". Whole-home requests continue to use the
// existing canonical square-footage engine unchanged.
// ============================================================================

export const PARTIAL_WINDOW_RULE_VERSION = "partial_window_v1";
export const PARTIAL_WINDOW_PRICE_PER_SIDE = 10;

export type PartialSides = "outside_only" | "inside_and_outside";

export interface PartialInput {
  windowCount: number;
  sides: PartialSides;
}

export interface PartialQuote {
  price: number;
  sidesMultiplier: 1 | 2;
  windowCount: number;
  sides: PartialSides;
  ruleVersion: string;
}

export function computePartialWindowPrice(input: PartialInput): PartialQuote {
  const windowCount = Math.max(0, Math.floor(input.windowCount));
  const sidesMultiplier: 1 | 2 = input.sides === "inside_and_outside" ? 2 : 1;
  const price = windowCount * sidesMultiplier * PARTIAL_WINDOW_PRICE_PER_SIDE;
  return {
    price,
    sidesMultiplier,
    windowCount,
    sides: input.sides,
    ruleVersion: PARTIAL_WINDOW_RULE_VERSION,
  };
}