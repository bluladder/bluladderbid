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

// ---------------------------------------------------------------------------
// Business-day enforcement (Defect 1).
//
// A day is customer-bookable only when it is an active BUSINESS working day.
// Business working days are administrator-configurable (pricing_config
// "business_hours".workDays) and DEFAULT to Monday–Friday. Saturdays (6) and
// Sundays (0) are therefore never offered unless an admin explicitly adds them
// to the business workDays. This is enforced server-side for EVERY channel that
// reads availability (online booking, AI chat, day/week/month grid,
// rescheduling and future voice tools), so it can never be bypassed by only
// filtering on the frontend.
//
// dayOfWeek uses JS convention: 0 = Sunday … 6 = Saturday.
// ---------------------------------------------------------------------------
export const DEFAULT_BUSINESS_WORK_DAYS = [1, 2, 3, 4, 5];

export function isBusinessDay(dayOfWeek: number, businessWorkDays: number[]): boolean {
  return businessWorkDays.includes(dayOfWeek);
}

/**
 * The days a technician can actually be booked = the intersection of the
 * technician's own work days and the business working days. An empty or absent
 * technician list falls back to the business days, but the business days ALWAYS
 * act as the outer gate — a technician cannot make a weekend bookable just
 * because their individual record lists Saturday. Existing weekend Jobber
 * visits still appear as busy blocks for admins; they never open weekend
 * booking here.
 */
export function effectiveWorkDays(
  techWorkDays: number[] | null | undefined,
  businessWorkDays: number[],
): number[] {
  const base = Array.isArray(techWorkDays) && techWorkDays.length > 0 ? techWorkDays : businessWorkDays;
  return base.filter((d) => businessWorkDays.includes(d));
}

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