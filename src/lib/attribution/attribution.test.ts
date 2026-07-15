import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureAttribution,
  readAttribution,
  __resetAttributionForTests,
  getOrCreateSourceSessionId,
} from './attribution';

function url(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe('attribution', () => {
  beforeEach(() => {
    __resetAttributionForTests();
  });

  it('captures all whitelisted params and creates a stable session id', () => {
    const s = captureAttribution(
      url({
        utm_source: 'facebook',
        utm_campaign: 'window-offer',
        fbclid: 'ABC123',
        landing_page_slug: 'fb-window-cleaning-offer-bid',
        source_session_id: 'sess-1',
      }),
    );
    expect(s.source_session_id).toBe('sess-1');
    expect(s.first_touch.utm_source).toBe('facebook');
    expect(s.first_touch.fbclid).toBe('ABC123');
    expect(s.landing_page_slug).toBe('fb-window-cleaning-offer-bid');

    // stable across reads
    expect(getOrCreateSourceSessionId()).toBe('sess-1');
    const s2 = readAttribution();
    expect(s2.first_touch.utm_source).toBe('facebook');
  });

  it('does not overwrite a valid Meta first-touch with later direct traffic', () => {
    captureAttribution(url({ utm_source: 'facebook', fbclid: 'XYZ' }));
    const s2 = captureAttribution(new URLSearchParams());
    // direct traffic must not overwrite
    expect(s2.first_touch.utm_source).toBe('facebook');
    expect(s2.first_touch.fbclid).toBe('XYZ');
  });

  it('upgrades a non-Meta first-touch to Meta when a Meta touch arrives', () => {
    captureAttribution(url({ utm_source: 'google', utm_medium: 'cpc' }));
    const s2 = captureAttribution(url({ utm_source: 'facebook', fbclid: 'F1' }));
    expect(s2.first_touch.utm_source).toBe('facebook');
    expect(s2.first_touch.fbclid).toBe('F1');
  });

  it('rejects PII-shaped values (email/phone)', () => {
    const s = captureAttribution(
      url({ utm_source: 'test@example.com', utm_campaign: '415-555-1234' }),
    );
    expect(s.first_touch.utm_source).toBeUndefined();
    expect(s.first_touch.utm_campaign).toBeUndefined();
  });

  it('caps oversize values', () => {
    const long = 'x'.repeat(500);
    const s = captureAttribution(url({ utm_campaign: long }));
    expect((s.first_touch.utm_campaign ?? '').length).toBeLessThanOrEqual(200);
  });
});
