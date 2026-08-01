const SERVICE_MINUTES: Readonly<Record<string, number>> = {
  window_cleaning: 90,
  house_wash: 60,
  gutter_cleaning: 45,
  roof_cleaning: 90,
  driveway_cleaning: 60,
  pressure_washing: 45,
  solar_panel_cleaning: 45,
  screen_repair: 30,
  window_promo_99: 90,
};

export function authoritativeBookingDurationMinutes(
  lineItemKeys: readonly string[],
): number {
  const distinct = new Set(lineItemKeys);
  const minutes = [...distinct].reduce(
    (total, key) => total + (SERVICE_MINUTES[key] ?? 0),
    0,
  );
  return Math.max(60, minutes);
}

export function scheduledIntervalMinutes(
  startIso: string,
  endIso: string,
): number | null {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return Math.round((end - start) / 60_000);
}

/** Postgres may serialize the same timestamptz with a different offset/shape. */
export function sameScheduledInstant(
  leftIso: string | null | undefined,
  rightIso: string | null | undefined,
): boolean {
  if (!leftIso || !rightIso) return false;
  const left = Date.parse(leftIso);
  const right = Date.parse(rightIso);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}
