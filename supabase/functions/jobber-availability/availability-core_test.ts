import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  blockOverlapsDay,
  filterBlocksForDay,
  slotHasConflict,
  type BusyInterval,
  isBusinessDay,
  effectiveWorkDays,
  DEFAULT_BUSINESS_WORK_DAYS,
} from "./availability-core.ts";

// Fixed reference work day: 2026-07-02, 09:00 -> 17:00 UTC.
const dayStart = Date.UTC(2026, 6, 2, 9, 0);
const dayEnd = Date.UTC(2026, 6, 2, 17, 0);
const h = (hour: number, min = 0) => Date.UTC(2026, 6, 2, hour, min);

Deno.test("blockOverlapsDay: all-day block starting before dayStart is included", () => {
  // "Day off" beginning at midnight, before the 09:00 work-day start.
  const blockStart = Date.UTC(2026, 6, 2, 0, 0);
  const blockEnd = Date.UTC(2026, 6, 2, 23, 59);
  assert(blockOverlapsDay(blockStart, blockEnd, dayStart, dayEnd));
});

Deno.test("blockOverlapsDay: block starting before dayStart but ending mid-day is included", () => {
  // 08:30 -> 10:00 job spilling into the morning. The buggy `start >= dayStart`
  // check would have dropped this and freed up real busy time.
  assert(blockOverlapsDay(h(8, 30), h(10, 0), dayStart, dayEnd));
});

Deno.test("blockOverlapsDay: block fully before the work day is excluded", () => {
  assertFalse(blockOverlapsDay(h(6, 0), h(8, 0), dayStart, dayEnd));
});

Deno.test("blockOverlapsDay: block fully after the work day is excluded", () => {
  assertFalse(blockOverlapsDay(h(18, 0), h(20, 0), dayStart, dayEnd));
});

Deno.test("blockOverlapsDay: block touching dayStart edge (ends exactly at dayStart) is excluded", () => {
  // Half-open: a block ending exactly at 09:00 does not overlap the work day.
  assertFalse(blockOverlapsDay(h(7, 0), h(9, 0), dayStart, dayEnd));
});

Deno.test("blockOverlapsDay: block spanning the entire work day is included", () => {
  assert(blockOverlapsDay(h(5, 0), h(22, 0), dayStart, dayEnd));
});

Deno.test("filterBlocksForDay: keeps overlapping (incl. pre-dayStart) and drops outside blocks", () => {
  const blocks = [
    { id: "before-only", start: h(6, 0), end: h(8, 0) }, // out
    { id: "spills-into-morning", start: h(8, 30), end: h(10, 0) }, // in
    { id: "midday", start: h(12, 0), end: h(13, 0) }, // in
    { id: "after-only", start: h(18, 0), end: h(19, 0) }, // out
    { id: "all-day", start: Date.UTC(2026, 6, 2, 0, 0), end: h(23, 59) }, // in
  ];
  const kept = filterBlocksForDay(blocks, dayStart, dayEnd).map((b) => b.id);
  assertEquals(kept, ["spills-into-morning", "midday", "all-day"]);
});

// --- Slot conflict / no-double-booking guarantees ---------------------------

const interval = (
  start: number,
  end: number,
  bufferBefore = 0,
  bufferAfter = 15,
): BusyInterval => ({
  start,
  end,
  expandedStart: start - bufferBefore * 60_000,
  expandedEnd: end + bufferAfter * 60_000,
});

Deno.test("slotHasConflict: 09:00 slot conflicts with a block that started at 08:30", () => {
  // Tech busy 08:30-10:00. A 120-min slot starting at 09:00 (ends 11:00) must
  // be rejected — this is the exact double-booking the engine previously allowed.
  const busy = [interval(h(8, 30), h(10, 0))];
  const slotStart = h(9, 0);
  const slotEndWithBuffer = h(11, 0) + 15 * 60_000;
  assert(slotHasConflict(slotStart, slotEndWithBuffer, busy));
});

Deno.test("slotHasConflict: slot fully after the busy block (incl. buffer) is free", () => {
  // Busy 08:30-10:00 (+15m buffer => free at 10:15). A 10:15 slot is fine.
  const busy = [interval(h(8, 30), h(10, 0))];
  const slotStart = h(10, 15);
  const slotEndWithBuffer = h(12, 15) + 15 * 60_000;
  assertFalse(slotHasConflict(slotStart, slotEndWithBuffer, busy));
});

Deno.test("slotHasConflict: slot ending inside the buffer window still conflicts", () => {
  // Busy 08:30-10:00, buffered free time starts 10:15. A slot whose buffered
  // end lands at 10:05 overlaps the trailing buffer and must be rejected.
  const busy = [interval(h(8, 30), h(10, 0))];
  const slotStart = h(7, 30);
  const slotEndWithBuffer = h(10, 5);
  assert(slotHasConflict(slotStart, slotEndWithBuffer, busy));
});

Deno.test("no double-bookable slots: enumerated 09-17 day around an 08:30-10:00 block", () => {
  // Simulate the engine's slot loop: 120-min slots at 15-min increments across
  // the work day, with a busy block that STARTS BEFORE dayStart (08:30-10:00).
  const durationMs = 120 * 60_000;
  const slotIncrementMs = 15 * 60_000;
  const bufferAfterMs = 15 * 60_000;
  const busy = [interval(h(8, 30), h(10, 0))];

  let conflictingSlotsOffered = 0;
  let firstFreeSlot: number | null = null;

  for (let s = dayStart; s + durationMs <= dayEnd; s += slotIncrementMs) {
    const slotEndWithBuffer = s + durationMs + bufferAfterMs;
    const conflict = slotHasConflict(s, slotEndWithBuffer, busy);
    if (!conflict) {
      if (firstFreeSlot === null) firstFreeSlot = s;
      // A truly free slot must NOT overlap the raw busy window [08:30,10:00].
      const slotEnd = s + durationMs;
      const overlapsRaw = s < busy[0].end && slotEnd > busy[0].start;
      if (overlapsRaw) conflictingSlotsOffered++;
    }
  }

  assertEquals(conflictingSlotsOffered, 0);
  // First bookable slot must be at/after the buffered end (10:15), never 09:00.
  assert(firstFreeSlot !== null);
  assert(firstFreeSlot! >= h(10, 15), `first free slot was ${new Date(firstFreeSlot!).toISOString()}`);
});

Deno.test("no slots offered when an all-day block covers the entire work day", () => {
  const durationMs = 120 * 60_000;
  const slotIncrementMs = 15 * 60_000;
  const bufferAfterMs = 15 * 60_000;
  // All-day "Day off" from midnight to end of day — starts well before dayStart.
  const busy = [interval(Date.UTC(2026, 6, 2, 0, 0), h(23, 59), 0, 0)];

  let freeSlots = 0;
  for (let s = dayStart; s + durationMs <= dayEnd; s += slotIncrementMs) {
    if (!slotHasConflict(s, s + durationMs + bufferAfterMs, busy)) freeSlots++;
  }
  assertEquals(freeSlots, 0);
});