import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireLead,
  fireSchedule,
  fireCompleteRegistration,
  hasFired,
  __resetPixelDedupForTests,
  deriveQuoteId,
} from './metaPixel';
import { __resetAttributionForTests } from './attribution';

function installFbq() {
  const calls: Array<[string, string, Record<string, unknown> | undefined, unknown]> = [];
  (window as unknown as { fbq: (...a: unknown[]) => void }).fbq = (
    cmd: string,
    ev: string,
    p?: Record<string, unknown>,
    o?: unknown,
  ) => {
    calls.push([cmd, ev, p, o]);
  };
  return calls;
}

beforeEach(() => {
  __resetAttributionForTests();
  __resetPixelDedupForTests();
  // reset fbq
  (window as unknown as { fbq?: unknown }).fbq = undefined;
});

describe('metaPixel', () => {
  it('does not fire Lead without a firm quote', () => {
    const calls = installFbq();
    const fired = fireLead({
      id: 'q1',
      firm: false,
      quoted_total: 500,
      service_count: 2,
      services_selected: ['windowCleaning', 'gutterCleaning'],
    });
    expect(fired).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('fires Lead exactly once for the same canonical quote id (dedup across rerenders/refresh)', () => {
    const calls = installFbq();
    const quote = {
      id: 'q_abc',
      firm: true,
      quoted_total: 749,
      service_count: 2,
      services_selected: ['windowCleaning', 'gutterCleaning'],
    };
    expect(fireLead(quote)).toBe(true);
    expect(fireLead(quote)).toBe(false);
    expect(fireLead(quote)).toBe(false);
    expect(calls.length).toBe(1);
    expect(hasFired('lead_q_abc')).toBe(true);
    // Value equals canonical quoted_total exactly.
    expect((calls[0][2] as { value: number }).value).toBe(749);
  });

  it('Schedule requires jobber_visit_id (failed booking → no fire)', () => {
    const calls = installFbq();
    const failed = fireSchedule({
      id: 'b1',
      jobber_visit_id: null,
      booked_revenue: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    });
    expect(failed).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('Schedule fires once and uses server-authoritative booked_revenue', () => {
    const calls = installFbq();
    const booking = {
      id: 'b_1',
      jobber_visit_id: 'V1',
      booked_revenue: 812.5,
      service_count: 3,
      services_selected: ['windowCleaning', 'gutterCleaning', 'houseWash'],
    };
    expect(fireSchedule(booking)).toBe(true);
    expect(fireSchedule(booking)).toBe(false); // idempotent replay
    expect(calls.length).toBe(1);
    expect(calls[0][1]).toBe('Schedule');
    expect((calls[0][2] as { value: number }).value).toBe(812.5);
  });

  it('CompleteRegistration fires once per booking', () => {
    const calls = installFbq();
    const booking = {
      id: 'b_2',
      jobber_visit_id: 'V2',
      booked_revenue: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    };
    expect(fireCompleteRegistration(booking)).toBe(true);
    expect(fireCompleteRegistration(booking)).toBe(false);
    expect(calls.length).toBe(1);
  });

  it('strips PII from event payloads', () => {
    const calls = installFbq();
    // Cast to unknown so we can plant PII fields that TypeScript would reject.
    fireSchedule({
      id: 'b_3',
      jobber_visit_id: 'V3',
      booked_revenue: 400,
      service_count: 1,
      services_selected: ['windowCleaning'],
      city: 'Austin',
      zip_code: '78701',
      email: 'foo@bar.com',
      phone: '+1 415 555 1234',
    } as unknown as Parameters<typeof fireSchedule>[0]);
    const payload = calls[0][2] as Record<string, unknown>;
    expect(payload.email).toBeUndefined();
    expect(payload.phone).toBeUndefined();
    expect(payload.city).toBe('Austin');
    expect(payload.zip_code).toBe('78701');
  });

  it('deriveQuoteId is stable for the same canonical fingerprint', () => {
    const a = deriveQuoteId({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 500,
      services: ['a', 'b'],
      session: 'sess',
    });
    const b = deriveQuoteId({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 500,
      services: ['b', 'a'], // order-independent
      session: 'sess',
    });
    expect(a).toBe(b);
    const c = deriveQuoteId({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 501,
      services: ['a', 'b'],
      session: 'sess',
    });
    expect(a).not.toBe(c);
  });
});
