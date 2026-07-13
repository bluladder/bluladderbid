import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  compactSlots,
  computeMinViableGap,
  DEFAULT_COMPACTION_CONFIG,
  evaluateSlot,
  type CompactionSlotInput,
  type ResolvedCompactionConfig,
} from "./scheduleCompaction.ts";

// Reference day: 2026-07-20. Helper to build an epoch-ms time on that day.
const t = (hour: number, min = 0) => Date.UTC(2026, 6, 20, hour, min);
const MIN = 60_000;

const cfg = (over: Partial<ResolvedCompactionConfig> = {}): ResolvedCompactionConfig => ({
  ...DEFAULT_COMPACTION_CONFIG,
  ...over,
});

// A candidate 2-hour job starting at `startHour:startMin` inside a free block.
function slot(
  startHour: number,
  startMin: number,
  freeStart: number,
  freeEnd: number,
  durationMin = 120,
  tech = "tech-1",
): CompactionSlotInput {
  const startMs = t(startHour, startMin);
  return {
    technicianId: tech,
    startMs,
    endMs: startMs + durationMin * MIN,
    freeBlockStartMs: freeStart,
    freeBlockEndMs: freeEnd,
  };
}

// ---------------------------------------------------------------------------
// 1. Two-hour job in a 1:15–5:00 block returns exactly 1:15 and 3:00.
// ---------------------------------------------------------------------------
Deno.test("compaction: 2h job in 1:15–5:00 block returns 1:15 and 3:00 only", () => {
  const freeStart = t(13, 15); // 1:15 PM
  const freeEnd = t(17, 0); // 5:00 PM
  const inputs: CompactionSlotInput[] = [];
  // Enumerate every 15-min start the engine would have produced (1:15 .. 3:00).
  for (let m = t(13, 15); m + 120 * MIN <= freeEnd; m += 15 * MIN) {
    const d = new Date(m);
    inputs.push(slot(d.getUTCHours(), d.getUTCMinutes(), freeStart, freeEnd));
  }
  const out = compactSlots(inputs, cfg());
  const shownStarts = out
    .filter((r) => r.shown)
    .map((r) => new Date(inputs[r.index].startMs).toISOString().slice(11, 16))
    .sort();
  assertEquals(shownStarts, ["13:15", "15:00"]);
});

// ---------------------------------------------------------------------------
// 2. Intermediate starts leaving 15–45 minute fragments are rejected.
// ---------------------------------------------------------------------------
Deno.test("compaction: intermediate 15/30/45-min fragments are rejected", () => {
  const freeStart = t(13, 15);
  const freeEnd = t(17, 0);
  // 1:30 leaves a 15-min fragment before it.
  const s130 = evaluateSlot(slot(13, 30, freeStart, freeEnd), cfg(), computeMinViableGap(cfg()));
  assertFalse(s130.accepted);
  assertEquals(s130.filterReason, "unusable_gap_before");
  // 2:45 leaves a 15-min fragment after it (ends 4:45, block ends 5:00).
  const s245 = evaluateSlot(slot(14, 45, freeStart, freeEnd), cfg(), computeMinViableGap(cfg()));
  assertFalse(s245.accepted);
  assertEquals(s245.filterReason, "unusable_gap_after");
});

// ---------------------------------------------------------------------------
// 3. A 60+ minute gap is retained only when a service + buffer can fit.
// ---------------------------------------------------------------------------
Deno.test("compaction: min viable gap respects shortest service + buffer", () => {
  // Default: no service signal → minViableGap == fallback (60).
  assertEquals(computeMinViableGap(cfg()), 60);
  // Shortest service 90 + buffer 15 => 105. A 60-min gap is NOT fillable.
  const withService = cfg({ shortestFillableServiceMinutes: 90, transitionBufferMinutes: 15 });
  assertEquals(computeMinViableGap(withService), 105);

  const freeStart = t(9, 0);
  // Block 9:00–11:00 (120 min) with a 60-min job packed at start leaves a
  // 60-min gap after — usable by default, NOT usable when nothing fits in 60.
  const packedStart60 = slot(9, 0, freeStart, t(11, 0), 60);
  assert(evaluateSlot(packedStart60, cfg(), computeMinViableGap(cfg())).accepted); // packs start anyway
  // An interior start that relies on the trailing gap being fillable:
  // start 9:00 job 60 -> gapAfter 60. With minViable 105 the trailing 60 is not
  // fillable, but it still packs the start (gapBefore 0) so it is accepted.
  // Prove the trailing-gap rejection on an interior candidate instead:
  const interior = slot(10, 0, freeStart, t(13, 0), 60); // gapBefore 60, gapAfter 120
  // With the default fallback (60) both 60-min gaps are fillable -> accepted.
  assert(evaluateSlot(interior, cfg(), computeMinViableGap(cfg())).accepted);
  // With a 105-min minimum viable gap, the leading 60-min gap can no longer host
  // the shortest service + buffer, so the interior candidate is rejected.
  const rejected = evaluateSlot(interior, withService, computeMinViableGap(withService));
  assertFalse(rejected.accepted);
  assertEquals(rejected.filterReason, "unusable_gap_before");
});

// ---------------------------------------------------------------------------
// 4. A candidate with useful space on both sides may remain available.
// ---------------------------------------------------------------------------
Deno.test("compaction: interior slot viable on both sides is accepted", () => {
  // Block 9:00–17:00. Start 11:00 (2h) -> gapBefore 120, gapAfter 240. Both viable.
  const s = evaluateSlot(slot(11, 0, t(9, 0), t(17, 0)), cfg(), computeMinViableGap(cfg()));
  assert(s.accepted);
  assertFalse(s.packsStart);
  assertFalse(s.packsEnd);
});

// ---------------------------------------------------------------------------
// 5. Exact boundary-packed appointments are preferred (rank highest).
// ---------------------------------------------------------------------------
Deno.test("compaction: boundary-packed slots outrank interior ones", () => {
  const freeStart = t(9, 0);
  const freeEnd = t(17, 0);
  const packedStart = evaluateSlot(slot(9, 0, freeStart, freeEnd), cfg(), computeMinViableGap(cfg()));
  const interior = evaluateSlot(slot(12, 0, freeStart, freeEnd), cfg(), computeMinViableGap(cfg()));
  assert(packedStart.compactionScore > interior.compactionScore);
  assert(packedStart.packsStart);
});

// ---------------------------------------------------------------------------
// 6. Multiple separate free blocks each return their own compact options.
// ---------------------------------------------------------------------------
Deno.test("compaction: each free block yields its own earliest/latest", () => {
  const blockA = { start: t(9, 0), end: t(12, 0) }; // 9–12 (fits one 2h + fillable? 9:00 gapAfter 60)
  const blockB = { start: t(13, 15), end: t(17, 0) }; // 1:15–5:00
  const inputs: CompactionSlotInput[] = [];
  for (let m = blockA.start; m + 120 * MIN <= blockA.end; m += 15 * MIN) {
    const d = new Date(m);
    inputs.push(slot(d.getUTCHours(), d.getUTCMinutes(), blockA.start, blockA.end));
  }
  for (let m = blockB.start; m + 120 * MIN <= blockB.end; m += 15 * MIN) {
    const d = new Date(m);
    inputs.push(slot(d.getUTCHours(), d.getUTCMinutes(), blockB.start, blockB.end));
  }
  const out = compactSlots(inputs, cfg());
  const shown = out.filter((r) => r.shown).map((r) => new Date(inputs[r.index].startMs).toISOString().slice(11, 16)).sort();
  // Block A (9–12, 2h job): 9:00 packs start (gapAfter 60 fillable) and 10:00
  // packs end (gapBefore 60 fillable). Block B: 1:15 and 3:00.
  assertEquals(shown, ["09:00", "10:00", "13:15", "15:00"]);
});

// ---------------------------------------------------------------------------
// 7. Customer views do not display every 15-minute increment (cap enforced).
// ---------------------------------------------------------------------------
Deno.test("compaction: a whole-day block collapses to a capped set, not every 15 min", () => {
  const freeStart = t(9, 0);
  const freeEnd = t(17, 0);
  const inputs: CompactionSlotInput[] = [];
  for (let m = freeStart; m + 120 * MIN <= freeEnd; m += 15 * MIN) {
    const d = new Date(m);
    inputs.push(slot(d.getUTCHours(), d.getUTCMinutes(), freeStart, freeEnd));
  }
  const shownCount = compactSlots(inputs, cfg({ maxCompactSlotsPerBlock: 4 })).filter((r) => r.shown).length;
  assert(shownCount <= 4, `expected <= 4 shown, got ${shownCount}`);
  assert(shownCount >= 2, `expected earliest + latest at least, got ${shownCount}`);
  assert(inputs.length > 7, "sanity: engine produced the redundant row we are compacting");
});

// ---------------------------------------------------------------------------
// 12. Filtering does not create false availability: an invalid/negative block
//     is never shown.
// ---------------------------------------------------------------------------
Deno.test("compaction: inconsistent block math is failed closed", () => {
  const bad: CompactionSlotInput = {
    technicianId: "tech-1",
    startMs: t(9, 0),
    endMs: t(11, 0),
    freeBlockStartMs: t(9, 30), // start is BEFORE the free block start (impossible)
    freeBlockEndMs: t(17, 0),
  };
  const out = compactSlots([bad], cfg());
  assertFalse(out[0].shown);
  assertEquals(out[0].filterReason, "block_math_inconsistent");
});

// ---------------------------------------------------------------------------
// 13. Route-density influences ranking (route bonus raises compaction score).
// ---------------------------------------------------------------------------
Deno.test("compaction: route density raises compaction score", () => {
  const base = slot(11, 0, t(9, 0), t(17, 0));
  const plain = evaluateSlot(base, cfg(), computeMinViableGap(cfg()));
  const routed = evaluateSlot({ ...base, routeBonus: 15, routeDensityScore: 90 }, cfg(), computeMinViableGap(cfg()));
  assert(routed.compactionScore > plain.compactionScore);
});
