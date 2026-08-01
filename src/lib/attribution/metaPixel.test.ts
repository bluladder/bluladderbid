import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fireLead,
  fireInitiateCheckout,
  fireSchedule,
  hasFired,
  __resetPixelDedupForTests,
  deriveQuoteFingerprint,
} from './metaPixel';
import { __resetAttributionForTests } from './attribution';
import { buildMetaEventId } from './metaEventContract';
import {
  __resetMetaTrackingConsentForTests,
  setMetaTrackingConsent,
} from './metaConsent';

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
  __resetMetaTrackingConsentForTests();
  // reset fbq
  (window as unknown as { fbq?: unknown }).fbq = undefined;
});

describe('metaPixel', () => {
  it('does not fire Lead without a firm quote', () => {
    const calls = installFbq();
    const fired = fireLead({
      id: 'q1',
      persisted: false,
      firm: false,
      quoted_total: 500,
      service_count: 2,
      services_selected: ['windowCleaning', 'gutterCleaning'],
    });
    expect(fired).toBe(false);
    expect(calls.length).toBe(0);
  });

  it('requires durable quote persistence before Lead', () => {
    const calls = installFbq();
    expect(fireLead({
      id: 'q-persisted',
      persisted: false,
      firm: true,
      quoted_total: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('fires Lead exactly once for the same canonical quote id (dedup across rerenders/refresh)', () => {
    const calls = installFbq();
    const quote = {
      id: 'q_abc',
      persisted: true,
      firm: true,
      quoted_total: 749,
      service_count: 2,
      services_selected: ['windowCleaning', 'gutterCleaning'],
    };
    expect(fireLead(quote)).toBe(true);
    expect(fireLead(quote)).toBe(false);
    expect(fireLead(quote)).toBe(false);
    expect(calls.length).toBe(1);
    expect(hasFired('blb_v1_lead_q_abc')).toBe(true);
    // Value equals canonical quoted_total exactly.
    expect((calls[0][2] as { value: number }).value).toBe(749);
  });

  it('does not duplicate a persisted Lead after add-on repricing', () => {
    const calls = installFbq();
    expect(fireLead({
      id: 'persisted-quote-1',
      persisted: true,
      firm: true,
      quoted_total: 400,
      service_count: 1,
      services_selected: ['houseWash'],
    })).toBe(true);
    expect(fireLead({
      id: 'persisted-quote-1',
      persisted: true,
      firm: true,
      quoted_total: 549,
      service_count: 2,
      services_selected: ['houseWash', 'gutterCleaning'],
    })).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0][2]).toMatchObject({ value: 400 });
  });

  it('does not mark an event fired until fbq is available and invoked', () => {
    const quote = {
      id: 'q_retry',
      persisted: true,
      firm: true,
      quoted_total: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    };
    expect(fireLead(quote)).toBe(false);
    expect(hasFired('blb_v1_lead_q_retry')).toBe(false);

    const calls = installFbq();
    expect(fireLead(quote)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(hasFired('blb_v1_lead_q_retry')).toBe(true);
  });

  it('fires InitiateCheckout once with the exact authoritative quote value', () => {
    const calls = installFbq();
    const quote = {
      id: 'q_checkout',
      firm: true,
      quoted_total: 812.5,
      service_count: 2,
      services_selected: ['windowCleaning', 'gutterCleaning'],
    };
    expect(fireInitiateCheckout(quote)).toBe(true);
    expect(fireInitiateCheckout(quote)).toBe(false);
    expect(calls[0][1]).toBe('InitiateCheckout');
    expect(calls[0][2]).toMatchObject({ value: 812.5, currency: 'USD' });
    expect(calls[0][3]).toEqual({ eventID: 'blb_v1_initiate_checkout_q_checkout' });
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
    expect(calls[0][2]).toMatchObject({ currency: 'USD' });
    expect(calls[0][3]).toEqual({ eventID: 'blb_v1_schedule_b_1' });
  });

  it('does not emit CompleteRegistration or Purchase for a confirmed booking', () => {
    const calls = installFbq();
    const booking = {
      id: 'b_2',
      jobber_visit_id: 'V2',
      booked_revenue: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    };
    expect(fireSchedule(booking)).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls.map((call) => call[1])).toEqual(['Schedule']);
    expect(calls.map((call) => call[1])).not.toContain('CompleteRegistration');
    expect(calls.map((call) => call[1])).not.toContain('Purchase');
  });

  it('fails closed when Meta tracking consent is denied', () => {
    const calls = installFbq();
    setMetaTrackingConsent('denied');
    expect(fireInitiateCheckout({
      id: 'q_denied',
      firm: true,
      quoted_total: 500,
      service_count: 1,
      services_selected: ['windowCleaning'],
    })).toBe(false);
    expect(calls).toHaveLength(0);
    expect(hasFired('blb_v1_initiate_checkout_q_denied')).toBe(false);
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
    const a = deriveQuoteFingerprint({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 500,
      services: ['a', 'b'],
      session: 'sess',
    });
    const b = deriveQuoteFingerprint({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 500,
      services: ['b', 'a'], // order-independent
      session: 'sess',
    });
    expect(a).toBe(b);
    const c = deriveQuoteFingerprint({
      ruleVersion: 3,
      engineVersion: 'v1',
      total: 501,
      services: ['a', 'b'],
      session: 'sess',
    });
    expect(a).not.toBe(c);
  });

  it('builds stable versioned IDs for future browser/server deduplication', () => {
    expect(buildMetaEventId('Lead', 'quote-123')).toBe('blb_v1_lead_quote-123');
    expect(buildMetaEventId('InitiateCheckout', 'quote-123')).toBe(
      'blb_v1_initiate_checkout_quote-123',
    );
    expect(buildMetaEventId('Schedule', 'booking-456')).toBe(
      'blb_v1_schedule_booking-456',
    );
    expect(buildMetaEventId('Lead', '   ')).toBeNull();
  });
});
