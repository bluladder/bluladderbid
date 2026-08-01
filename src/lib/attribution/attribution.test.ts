import { beforeEach, describe, expect, it } from 'vitest';
import {
  captureAttribution,
  readAttribution,
  __resetAttributionForTests,
  getOrCreateSourceSessionId,
} from './attribution';
import {
  __resetMetaTrackingConsentForTests,
  setMetaTrackingConsent,
} from './metaConsent';

function url(params: Record<string, string>): URLSearchParams {
  return new URLSearchParams(params);
}

describe('attribution', () => {
  beforeEach(() => {
    __resetAttributionForTests();
    __resetMetaTrackingConsentForTests();
    document.cookie = '_fbp=; Max-Age=0; path=/';
    document.cookie = '_fbc=; Max-Age=0; path=/';
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

  it('captures Meta _fbp and _fbc cookies when available', () => {
    document.cookie = '_fbp=fb.1.1700000000000.123456789; path=/';
    document.cookie = '_fbc=fb.1.1700000000000.ClickId123; path=/';
    const state = captureAttribution(url({ utm_source: 'facebook', fbclid: 'ClickId123' }));
    expect(state.fbp).toBe('fb.1.1700000000000.123456789');
    expect(state.fbc).toBe('fb.1.1700000000000.ClickId123');
    expect(state.first_touch.fbp).toBe(state.fbp);
    expect(state.first_touch.fbc).toBe(state.fbc);
    expect(readAttribution()).toMatchObject({ fbp: state.fbp, fbc: state.fbc });
  });

  it('does not read Meta cookies after explicit consent denial', () => {
    document.cookie = '_fbp=fb.1.1700000000000.123456789; path=/';
    document.cookie = '_fbc=fb.1.1700000000000.ClickId123; path=/';
    setMetaTrackingConsent('denied');
    const state = captureAttribution(url({ utm_source: 'facebook', fbclid: 'ClickId123' }));
    expect(state.fbp).toBeUndefined();
    expect(state.fbc).toBeUndefined();
  });
});
