// ===========================================================================
// scheduleCompaction.ts — deterministic, dependency-free schedule-compaction
// filter + ranking for customer-facing availability.
//
// The jobber-availability engine still enumerates every technically-valid
// 15-minute start time (respecting Jobber busy blocks, buffers, working hours,
// blocked time and slot reservations — none of which this module changes).
// This module then decides which of those valid start times are worth showing
// a customer, so a two-hour job in a 1:15–5:00 open block surfaces as 1:15 and
// 3:00 rather than a redundant row of seven near-identical starts that each
// leave an unusable 15–45 minute fragment.
//
// It is PURE (no Supabase / network / Date-formatting) so the acceptance rule,
// minimum-viable-gap math and ranking are fully unit-testable, and it NEVER
// invents availability: it only ranks/filters slots the engine already proved
// are technically bookable.
// ===========================================================================

export interface ResolvedCompactionConfig {
  /** Admin fallback: the smallest remaining gap (minutes) we treat as fillable. */
  minimumFillableGapMinutes: number;
  /** A remaining fragment at/below this many minutes counts as "packed" (≈zero). */
  boundaryGapToleranceMinutes: number;
  /** Max compact slots surfaced per contiguous free block (kills redundant rows). */
  maxCompactSlotsPerBlock: number;
  /**
   * Shortest active instant-bookable service duration (minutes) that could
   * genuinely fill a leftover gap. When known, a gap only counts as fillable if
   * it can host this service PLUS the transition buffer — so we never call a gap
   * fillable "just because it's over 60 minutes" when nothing actually fits.
   */
  shortestFillableServiceMinutes?: number | null;
  /** Travel/transition buffer (minutes) required around a would-be filler job. */
  transitionBufferMinutes?: number;
}

export const DEFAULT_COMPACTION_CONFIG: ResolvedCompactionConfig = {
  minimumFillableGapMinutes: 60,
  boundaryGapToleranceMinutes: 5,
  maxCompactSlotsPerBlock: 4,
  shortestFillableServiceMinutes: null,
  transitionBufferMinutes: 0,
};

/**
 * The minimum remaining gap that can actually host another appointment.
 *
 *  - With no service-duration signal, this is simply the admin fallback
 *    (`minimum_fillable_gap_minutes`, default 60).
 *  - When the shortest active service duration is known, the gap must be able to
 *    fit that service + its transition buffer, and never drops below the admin
 *    fallback. This is what prevents "looks long enough but nothing fits".
 */
export function computeMinViableGap(cfg: ResolvedCompactionConfig): number {
  const fallback = Math.max(0, cfg.minimumFillableGapMinutes);
  const shortest = cfg.shortestFillableServiceMinutes;
  if (typeof shortest === "number" && shortest > 0) {
    return Math.max(fallback, shortest + Math.max(0, cfg.transitionBufferMinutes ?? 0));
  }
  return fallback;
}

export interface CompactionSlotInput {
  technicianId: string;
  /** Candidate raw start (epoch ms). */
  startMs: number;
  /** Candidate raw end (epoch ms) = start + required job duration. */
  endMs: number;
  /** Earliest permissible raw START in the contiguous free block (epoch ms). */
  freeBlockStartMs: number;
  /** Latest permissible raw END in the contiguous free block (epoch ms). */
  freeBlockEndMs: number;
  /** Existing route-continuity bonus (kept so route efficiency still ranks). */
  routeBonus?: number;
  /** Existing route-density score (0–100). */
  routeDensityScore?: number;
}

export type CompactionFilterReason =
  | "unusable_gap_before"
  | "unusable_gap_after"
  | "redundant_interior"
  | "block_math_inconsistent";

export interface CompactionEvaluation {
  gapBeforeMinutes: number;
  gapAfterMinutes: number;
  minViableGapMinutes: number;
  packsStart: boolean;
  packsEnd: boolean;
  accepted: boolean;
  compactionScore: number;
  filterReason: CompactionFilterReason | null;
}

/**
 * Evaluate a single candidate against its contiguous free block.
 *
 * Slot acceptance rule (customer-displayable) requires BOTH sides to be either
 * boundary-packed (≈zero within tolerance) or a genuinely fillable gap:
 *   gapBefore ≤ tol OR gapBefore ≥ minViableGap
 *   gapAfter  ≤ tol OR gapAfter  ≥ minViableGap
 */
export function evaluateSlot(
  input: CompactionSlotInput,
  cfg: ResolvedCompactionConfig,
  minViableGap: number,
): CompactionEvaluation {
  const tol = Math.max(0, cfg.boundaryGapToleranceMinutes);
  const gapBefore = Math.round((input.startMs - input.freeBlockStartMs) / 60000);
  const gapAfter = Math.round((input.freeBlockEndMs - input.endMs) / 60000);

  const packsStart = gapBefore <= tol;
  const packsEnd = gapAfter <= tol;
  const beforeOk = packsStart || gapBefore >= minViableGap;
  const afterOk = packsEnd || gapAfter >= minViableGap;

  // A negative gap beyond tolerance means the block math is inconsistent with
  // the candidate — fail closed so we never manufacture false availability.
  const nonNegative = gapBefore >= -tol && gapAfter >= -tol;
  const accepted = nonNegative && beforeOk && afterOk;

  let filterReason: CompactionFilterReason | null = null;
  if (!accepted) {
    if (!nonNegative) filterReason = "block_math_inconsistent";
    else if (!beforeOk) filterReason = "unusable_gap_before";
    else filterReason = "unusable_gap_after";
  }

  // Compaction score (higher = tighter schedule). Boundary-packing dominates,
  // then route efficiency, then minimal leftover fragmentation.
  let score = 0;
  if (packsStart || packsEnd) score += 100; // packs against a free-block edge
  if (packsStart && packsEnd) score += 50; // exact fit — consumes the block
  const leftover = Math.max(0, gapBefore) + Math.max(0, gapAfter);
  score += Math.max(0, 60 - Math.min(leftover, 60)); // reward less fragmentation
  score += input.routeBonus ?? 0;
  if (typeof input.routeDensityScore === "number") {
    score += (input.routeDensityScore - 50) * 0.3; // extend an existing cluster/route
  }

  return {
    gapBeforeMinutes: gapBefore,
    gapAfterMinutes: gapAfter,
    minViableGapMinutes: minViableGap,
    packsStart,
    packsEnd,
    accepted,
    compactionScore: Math.round(score * 10) / 10,
    filterReason,
  };
}

export interface CompactionOutput extends CompactionEvaluation {
  /** Index back into the input array. */
  index: number;
  /** Final decision: surfaced to the customer. */
  shown: boolean;
}

/**
 * Compact a flat list of technically-valid candidate slots.
 *
 * Slots are grouped by (technician, contiguous free block). Within each block:
 *   1. Reject any candidate that would leave an unusable fragment (acceptance
 *      rule above).
 *   2. Always surface the earliest-accepted (packs the block start) and the
 *      latest-accepted (packs the block end).
 *   3. Surface additional interior starts only when they leave genuinely
 *      fillable blocks on both sides, ranked by compaction score, capped by
 *      `maxCompactSlotsPerBlock`.
 *
 * The result aligns 1:1 with `inputs` by `index`, carrying the gap math, the
 * minimum-viable-gap used, the compaction score and the filter reason so admins
 * can see exactly why each raw slot was shown or filtered.
 */
export function compactSlots(
  inputs: CompactionSlotInput[],
  cfg: ResolvedCompactionConfig,
): CompactionOutput[] {
  const minViableGap = computeMinViableGap(cfg);
  const cap = Math.max(1, Math.floor(cfg.maxCompactSlotsPerBlock));

  const results: CompactionOutput[] = inputs.map((inp, index) => ({
    ...evaluateSlot(inp, cfg, minViableGap),
    index,
    shown: false,
  }));

  const groups = new Map<string, number[]>();
  inputs.forEach((inp, i) => {
    const key = `${inp.technicianId}|${inp.freeBlockStartMs}|${inp.freeBlockEndMs}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(i);
    else groups.set(key, [i]);
  });

  for (const idxs of groups.values()) {
    const accepted = idxs.filter((i) => results[i].accepted);
    if (accepted.length === 0) continue;

    const sortedByStart = [...accepted].sort((a, b) => inputs[a].startMs - inputs[b].startMs);
    const earliest = sortedByStart[0];
    const latest = sortedByStart[sortedByStart.length - 1];

    const chosen = new Set<number>([earliest, latest]);

    // Interior accepted candidates (both sides genuinely fillable): rank by
    // compaction score, then earliest start, and fill remaining capacity.
    const interior = accepted
      .filter((i) => !chosen.has(i))
      .sort(
        (a, b) =>
          results[b].compactionScore - results[a].compactionScore ||
          inputs[a].startMs - inputs[b].startMs,
      );
    for (const i of interior) {
      if (chosen.size >= cap) break;
      chosen.add(i);
    }

    for (const i of accepted) {
      if (chosen.has(i)) {
        results[i].shown = true;
      } else {
        // Accepted but not surfaced: a redundant interior duplicate.
        results[i].filterReason = "redundant_interior";
      }
    }
  }

  return results;
}
