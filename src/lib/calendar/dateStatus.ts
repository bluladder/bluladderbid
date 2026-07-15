/**
 * Calendar date-status classification.
 *
 * This is a pure presentation helper. It does NOT compute availability —
 * it only classifies dates that the server-authoritative availability
 * system has already returned as valid customer-bookable slots.
 *
 * Inputs come from the existing `jobber-availability` response surfaced
 * through `useSmartAvailability` (rankedSlots + fullyBookedDays). No
 * Jobber, duration, technician, lead-time or reservation logic is
 * performed here.
 */

export type CalendarDateStatus =
  | 'open'
  | 'limited'
  | 'full'
  | 'unavailable'
  | 'unknown';

export interface DateStatusInfo {
  status: CalendarDateStatus;
  /** Number of customer-bookable slot options on this date (undefined for unknown/unavailable). */
  count?: number;
}

export interface DateStatusThresholds {
  /** Minimum count to display as "Open". Default 3. */
  openMin: number;
}

export const DEFAULT_DATE_STATUS_THRESHOLDS: DateStatusThresholds = {
  openMin: 3,
};

/**
 * Group ranked slots by their local calendar day.
 * `startTime` is an ISO string produced by the server.
 */
export function countSlotsPerDate(
  slots: ReadonlyArray<{ startTime: string }>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots) {
    // Use the ISO local calendar day. We intentionally slice the ISO string
    // rather than converting to a Date to avoid a timezone-related off-by-one.
    const day = s.startTime.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

/** Classify a single date given the derived slot count and full-day set. */
export function classifyDate(
  dateKey: string,
  slotCount: number | undefined,
  fullyBooked: ReadonlySet<string>,
  isBookableBusinessDay: boolean,
  thresholds: DateStatusThresholds = DEFAULT_DATE_STATUS_THRESHOLDS,
): DateStatusInfo {
  // Non-business / past / out-of-range dates: not classifiable.
  if (!isBookableBusinessDay) return { status: 'unavailable' };

  // Fully booked wins over anything else, even if a stray slot leaked into
  // the ranked list (defense in depth).
  if (fullyBooked.has(dateKey)) return { status: 'full', count: 0 };

  if (slotCount === undefined) {
    // We have no data for this date (e.g. beyond the loaded horizon).
    // Do NOT paint it as Open — fail closed to "unknown" so the UI can
    // render a neutral treatment without implying availability.
    return { status: 'unknown' };
  }

  if (slotCount <= 0) return { status: 'full', count: 0 };
  if (slotCount < thresholds.openMin) return { status: 'limited', count: slotCount };
  return { status: 'open', count: slotCount };
}

/** Build a full map of statuses for every date the caller cares about. */
export function buildDateStatusMap(params: {
  dates: ReadonlyArray<Date>;
  slots: ReadonlyArray<{ startTime: string }>;
  fullyBookedDays: ReadonlyArray<string>;
  isBookableBusinessDay: (date: Date) => boolean;
  thresholds?: DateStatusThresholds;
}): Record<string, DateStatusInfo> {
  const counts = countSlotsPerDate(params.slots);
  const full = new Set(params.fullyBookedDays);
  const out: Record<string, DateStatusInfo> = {};
  for (const d of params.dates) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;
    out[key] = classifyDate(
      key,
      counts[key],
      full,
      params.isBookableBusinessDay(d),
      params.thresholds ?? DEFAULT_DATE_STATUS_THRESHOLDS,
    );
  }
  return out;
}