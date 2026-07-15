import { describe, it, expect } from 'vitest';
import {
  buildDateStatusMap,
  classifyDate,
  countSlotsPerDate,
  DEFAULT_DATE_STATUS_THRESHOLDS,
} from './dateStatus';

describe('dateStatus classifier', () => {
  it('groups slot ISO strings by local calendar day', () => {
    const counts = countSlotsPerDate([
      { startTime: '2026-07-20T09:00:00Z' },
      { startTime: '2026-07-20T13:00:00Z' },
      { startTime: '2026-07-21T09:00:00Z' },
    ]);
    expect(counts).toEqual({ '2026-07-20': 2, '2026-07-21': 1 });
  });

  it('marks a date with several valid slots as Open', () => {
    const r = classifyDate('2026-07-20', 4, new Set(), true);
    expect(r).toEqual({ status: 'open', count: 4 });
  });

  it('marks a date with 1 or 2 valid slots as Limited', () => {
    expect(classifyDate('d', 1, new Set(), true)).toEqual({ status: 'limited', count: 1 });
    expect(classifyDate('d', 2, new Set(), true)).toEqual({ status: 'limited', count: 2 });
  });

  it('marks a bookable business day with zero valid slots as Full', () => {
    expect(classifyDate('d', 0, new Set(), true)).toEqual({ status: 'full', count: 0 });
  });

  it('honors the fully-booked set even when a stray slot leaks through', () => {
    expect(classifyDate('d', 5, new Set(['d']), true)).toEqual({ status: 'full', count: 0 });
  });

  it('marks past / weekend / out-of-range dates as Unavailable', () => {
    expect(classifyDate('d', 5, new Set(), false)).toEqual({ status: 'unavailable' });
    expect(classifyDate('d', undefined, new Set(), false)).toEqual({ status: 'unavailable' });
  });

  it('never paints unknown-horizon dates as Open (fails closed to unknown)', () => {
    expect(classifyDate('d', undefined, new Set(), true)).toEqual({ status: 'unknown' });
  });

  it('respects a configurable open threshold', () => {
    const t = { openMin: 5 };
    expect(classifyDate('d', 4, new Set(), true, t)).toEqual({ status: 'limited', count: 4 });
    expect(classifyDate('d', 5, new Set(), true, t)).toEqual({ status: 'open', count: 5 });
  });

  it('builds a per-date map covering every visible day', () => {
    const monday = new Date(2026, 6, 20); // Mon Jul 20 2026 local
    const tuesday = new Date(2026, 6, 21);
    const saturday = new Date(2026, 6, 25);
    const map = buildDateStatusMap({
      dates: [monday, tuesday, saturday],
      slots: [
        { startTime: '2026-07-20T09:00:00' },
        { startTime: '2026-07-20T13:00:00' },
        { startTime: '2026-07-20T16:00:00' },
        { startTime: '2026-07-21T09:00:00' },
      ],
      fullyBookedDays: [],
      isBookableBusinessDay: (d) => d.getDay() !== 0 && d.getDay() !== 6,
    });
    expect(map['2026-07-20'].status).toBe('open');
    expect(map['2026-07-21'].status).toBe('limited');
    expect(map['2026-07-25'].status).toBe('unavailable');
  });

  it('exports a sane default open threshold', () => {
    expect(DEFAULT_DATE_STATUS_THRESHOLDS.openMin).toBeGreaterThanOrEqual(2);
  });
});