// Pure, dependency-free helpers for slot/busy-block overlap logic.
// Extracted from index.ts so the core scheduling math can be unit-tested in
// isolation (no Supabase, no network, no timezone formatting).

export interface BusyInterval {
  // Raw block boundaries (the actual job/PTO window).
  start: number; // epoch ms
  end: number; // epoch ms
  // Boundaries expanded by travel/cleanup buffers used for slot conflict checks.
  expandedStart: number; // epoch ms
  expandedEnd: number; // epoch ms
}

const toMs = (v: number | Date): number => (v instanceof Date ? v.getTime() : v);

/**
 * A block belongs to a given work day if it OVERLAPS the work-day window at all.
 *
 * This is overlap-based on purpose: a block that *starts before* the work-day
 * start hour (e.g. an all-day "Day off" that begins at midnight, or an
 * early-morning job) still consumes part of the day and must be respected.
 * The previous `block.start >= dayStart` check dropped such blocks, which made
 * a busy technician look completely free.
 */
export function blockOverlapsDay(
  blockStart: number | Date,
  blockEnd: number | Date,
  dayStart: number | Date,
  dayEnd: number | Date,
): boolean {
  return toMs(blockStart) < toMs(dayEnd) && toMs(blockEnd) > toMs(dayStart);
}

/** Filter a technician's busy intervals down to those overlapping the work day. */
export function filterBlocksForDay<T extends { start: number | Date; end: number | Date }>(
  blocks: T[],
  dayStart: number | Date,
  dayEnd: number | Date,
): T[] {
  return blocks.filter((b) => blockOverlapsDay(b.start, b.end, dayStart, dayEnd));
}

/**
 * A candidate slot conflicts with a busy interval when the (buffered) slot
 * window overlaps the (buffered) busy window. Standard half-open interval
 * overlap test: touching edges (slotEnd === busyStart) do NOT conflict.
 */
export function slotHasConflict(
  slotStart: number | Date,
  slotEndWithBuffer: number | Date,
  busyTimes: BusyInterval[],
): boolean {
  const s = toMs(slotStart);
  const e = toMs(slotEndWithBuffer);
  return busyTimes.some((bt) => s < bt.expandedEnd && e > bt.expandedStart);
}