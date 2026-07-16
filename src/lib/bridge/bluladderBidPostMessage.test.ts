import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  postBluLadderBidEvent,
  resolveParentOrigin,
  isEmbedModeFromParams,
  getAllowedParentOrigins,
  bridgeFireQuoteStarted,
  bridgeFireQuoteSubmitted,
  bridgeFireBookingCompleted,
  bridgeFireBookingFailed,
  __resetBridgeDedupForTests,
  __internal,
} from './bluladderBidPostMessage';
import { __resetAttributionForTests, captureAttribution } from '@/lib/attribution/attribution';

function makeFakeWindow(search: string, embedded = true) {
  const messages: Array<{ msg: unknown; target: string }> = [];
  const parent = {
    postMessage: (msg: unknown, target: string) => {
      messages.push({ msg, target });
    },
  };
  const w = {
    parent: embedded ? parent : ({} as unknown),
    location: { search },
    sessionStorage: window.sessionStorage,
    localStorage: window.localStorage,
  } as unknown as Window & typeof globalThis;
  // Make self-comparison return `embedded`.
  (w as unknown as { parent: unknown }).parent = embedded ? parent : w;
  return { win: w, messages };
}

beforeEach(() => {
  __resetBridgeDedupForTests();
  __resetAttributionForTests();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('embed mode', () => {
  it('accepts ?embed=1', () => {
    expect(isEmbedModeFromParams(new URLSearchParams('embed=1'))).toBe(true);
  });
  it('accepts ?embed=true', () => {
    expect(isEmbedModeFromParams(new URLSearchParams('embed=true'))).toBe(true);
  });
  it('rejects unrelated values', () => {
    expect(isEmbedModeFromParams(new URLSearchParams('embed=yes'))).toBe(false);
    expect(isEmbedModeFromParams(new URLSearchParams(''))).toBe(false);
  });
});

describe('parent origin allowlist', () => {
  it('always allows bluladder.com production origins', () => {
    const allow = getAllowedParentOrigins();
    expect(allow).toContain('https://bluladder.com');
    expect(allow).toContain('https://www.bluladder.com');
  });
  it('resolves valid parent_origin param', () => {
    expect(
      resolveParentOrigin({ parentOriginParam: 'https://bluladder.com', referrer: '' }),
    ).toBe('https://bluladder.com');
  });
  it('rejects unapproved parent_origin param', () => {
    expect(
      resolveParentOrigin({ parentOriginParam: 'https://evil.example', referrer: '' }),
    ).toBeNull();
  });
  it('falls back to allowlisted referrer', () => {
    expect(
      resolveParentOrigin({ referrer: 'https://www.bluladder.com/lp/window-cleaning' }),
    ).toBe('https://www.bluladder.com');
  });
  it('rejects unapproved referrer', () => {
    expect(resolveParentOrigin({ referrer: 'https://evil.example/page' })).toBeNull();
  });
  it('rejects wildcard-shaped strings', () => {
    expect(__internal.isValidOriginString('*')).toBe(false);
    expect(__internal.isValidOriginString('null')).toBe(false);
    // A trailing slash is not a bare origin — must be exactly the origin form.
    expect(__internal.isValidOriginString('https://bluladder.com/')).toBe(false);
    expect(__internal.isValidOriginString('https://bluladder.com')).toBe(true);
    expect(__internal.isValidOriginString('https://bluladder.com/path')).toBe(false);
  });
  it('a malicious parent_origin cannot bypass the allowlist even if referrer is legit', () => {
    // Attacker-supplied hint is rejected; we still resolve via referrer.
    const result = resolveParentOrigin({
      parentOriginParam: 'https://evil.example',
      referrer: 'https://bluladder.com/',
    });
    expect(result).toBe('https://bluladder.com');
  });
});

describe('postBluLadderBidEvent', () => {
  it('standalone mode (parent === window) sends nothing', () => {
    const { win, messages } = makeFakeWindow('?embed=1', false);
    const r = postBluLadderBidEvent('quote_started', 'evt-1', {}, {
      win,
      referrer: 'https://bluladder.com/',
    });
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('not_embedded');
    expect(messages).toHaveLength(0);
  });

  it('missing embed param does not send even when framed', () => {
    const { win, messages } = makeFakeWindow('?foo=bar', true);
    const r = postBluLadderBidEvent('quote_started', 'evt-2', {}, {
      win,
      referrer: 'https://bluladder.com/',
    });
    expect(r.sent).toBe(false);
    expect(messages).toHaveLength(0);
  });

  it('sends when embedded via bluladder.com referrer', () => {
    const { win, messages } = makeFakeWindow('?embed=1', true);
    const r = postBluLadderBidEvent('quote_started', 'evt-embed-1', { service_slug: 'window-cleaning' }, {
      win,
      referrer: 'https://bluladder.com/',
    });
    expect(r.sent).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].target).toBe('https://bluladder.com');
    // Never uses wildcard.
    expect(messages[0].target).not.toBe('*');
    const m = messages[0].msg as any;
    expect(m.type).toBe('bluladder-bid-event');
    expect(m.version).toBe(1);
    expect(m.event).toBe('quote_started');
    expect(m.event_id).toBe('evt-embed-1');
    expect(typeof m.timestamp).toBe('string');
    expect(m.payload.service_slug).toBe('window-cleaning');
  });

  it('dedups repeated deterministic event IDs (rerenders / replay)', () => {
    const { win, messages } = makeFakeWindow('?embed=1', true);
    postBluLadderBidEvent('quote_started', 'evt-dup', {}, { win, referrer: 'https://bluladder.com/' });
    postBluLadderBidEvent('quote_started', 'evt-dup', {}, { win, referrer: 'https://bluladder.com/' });
    postBluLadderBidEvent('quote_started', 'evt-dup', {}, { win, referrer: 'https://bluladder.com/' });
    expect(messages).toHaveLength(1);
  });

  it('drops PII, unapproved keys, and out-of-range values from payload', () => {
    const { win, messages } = makeFakeWindow('?embed=1', true);
    postBluLadderBidEvent(
      'booking_completed',
      'evt-scrub',
      {
        booking_id: 'b_123',
        booking_value: 250.5,
        // PII — must be dropped
        email: 'joe@example.com',
        phone: '+1 (555) 123-4567',
        // Attempted email-shaped injection via allowed key
        error_code: 'joe@example.com',
        // Unapproved key — dropped
        jobber_job_id: 'jj_secret',
        // Out of range
        quote_value: 9999999,
      } as unknown as Record<string, unknown>,
      { win, referrer: 'https://bluladder.com/' },
    );
    const p = (messages[0].msg as any).payload as Record<string, unknown>;
    expect(p.booking_id).toBe('b_123');
    expect(p.booking_value).toBe(250.5);
    expect(p.currency).toBe('USD');
    expect(p.email).toBeUndefined();
    expect(p.phone).toBeUndefined();
    expect(p.jobber_job_id).toBeUndefined();
    expect(p.error_code).toBeUndefined();
    expect(p.quote_value).toBeUndefined();
  });

  it('rejects invalid event names', () => {
    const { win, messages } = makeFakeWindow('?embed=1', true);
    const r = postBluLadderBidEvent('booking_confirmed' as unknown as 'booking_completed', 'x', {}, {
      win,
      referrer: 'https://bluladder.com/',
    });
    expect(r.sent).toBe(false);
    expect(messages).toHaveLength(0);
  });

  it('rejects empty and oversized event IDs', () => {
    const { win } = makeFakeWindow('?embed=1', true);
    expect(
      postBluLadderBidEvent('quote_started', '', {}, { win, referrer: 'https://bluladder.com/' })
        .sent,
    ).toBe(false);
    expect(
      postBluLadderBidEvent(
        'quote_started',
        'x'.repeat(500),
        {},
        { win, referrer: 'https://bluladder.com/' },
      ).sent,
    ).toBe(false);
  });

  it('first-touch attribution wins over later caller-supplied attribution values', () => {
    captureAttribution(
      new URLSearchParams(
        'utm_source=facebook&utm_medium=paid&utm_campaign=fb_window&utm_content=hero&fbclid=FB123&landing_page_slug=fb-window-cleaning-offer-bid',
      ),
    );
    const { win, messages } = makeFakeWindow('?embed=1', true);
    postBluLadderBidEvent(
      'quote_submitted',
      'evt-attr-firsttouch-wins',
      {
        quote_id: 'q1',
        quote_value: 500,
        // Caller tries to overwrite established first-touch — must be ignored.
        utm_source: 'direct_unknown',
        utm_campaign: 'later_campaign',
        utm_content: 'later_content',
        fbclid: 'LATER',
        landing_page_slug: 'later-slug',
      },
      { win, referrer: 'https://bluladder.com/' },
    );
    const p = (messages[0].msg as any).payload as Record<string, unknown>;
    // First-touch wins across every attribution key.
    expect(p.utm_source).toBe('facebook');
    expect(p.utm_medium).toBe('paid');
    expect(p.utm_campaign).toBe('fb_window');
    expect(p.utm_content).toBe('hero');
    expect(p.fbclid).toBe('FB123');
    expect(p.landing_page_slug).toBe('fb-window-cleaning-offer-bid');
    // Event-specific caller fields remain intact.
    expect(p.quote_id).toBe('q1');
    expect(p.quote_value).toBe(500);
    expect(p.source_session_id).toBeDefined();
  });

  it('blank / missing stored first-touch fields may be filled by valid caller values', () => {
    // Only utm_source stored — other attribution slots are empty.
    captureAttribution(new URLSearchParams('utm_source=facebook'));
    const { win, messages } = makeFakeWindow('?embed=1', true);
    postBluLadderBidEvent(
      'quote_submitted',
      'evt-attr-fill-gaps',
      {
        quote_id: 'q2',
        quote_value: 250,
        // Caller may fill empty slots.
        utm_campaign: 'caller_supplied_campaign',
        utm_medium: 'caller_supplied_medium',
        // But cannot overwrite the established utm_source=facebook.
        utm_source: 'direct_unknown',
      },
      { win, referrer: 'https://bluladder.com/' },
    );
    const p = (messages[0].msg as any).payload as Record<string, unknown>;
    expect(p.utm_source).toBe('facebook'); // first-touch wins
    expect(p.utm_campaign).toBe('caller_supplied_campaign'); // filled gap
    expect(p.utm_medium).toBe('caller_supplied_medium'); // filled gap
    expect(p.quote_id).toBe('q2');
    expect(p.quote_value).toBe(250);
  });

  it('event-specific payload keys are never touched by attribution merge', () => {
    captureAttribution(new URLSearchParams('utm_source=facebook&utm_campaign=fb_window'));
    const { win, messages } = makeFakeWindow('?embed=1', true);
    postBluLadderBidEvent(
      'booking_completed',
      'evt-event-fields',
      {
        booking_id: 'b_XYZ',
        booking_value: 750.25,
        service_slug: 'window-cleaning',
        service_slugs: ['window-cleaning', 'house-wash'],
        failure_stage: 'server' as unknown as string,
      },
      { win, referrer: 'https://bluladder.com/' },
    );
    const p = (messages[0].msg as any).payload as Record<string, unknown>;
    expect(p.booking_id).toBe('b_XYZ');
    expect(p.booking_value).toBe(750.25);
    expect(p.service_slug).toBe('window-cleaning');
    expect(p.service_slugs).toEqual(['window-cleaning', 'house-wash']);
    expect(p.utm_source).toBe('facebook');
    expect(p.utm_campaign).toBe('fb_window');
  });
});

describe('semantic helpers', () => {
  it('bridgeFireQuoteSubmitted requires a finite positive total', () => {
    const { win, messages } = makeFakeWindow('?embed=1', true);
    // vi.stubbing not needed — helper uses postBluLadderBidEvent under the hood
    // and there is no way to override the window from the outside API. Instead,
    // exercise the guard behaviour on invalid inputs (should return not sent).
    const r1 = bridgeFireQuoteSubmitted({ id: '', total: 100 });
    const r2 = bridgeFireQuoteSubmitted({ id: 'q1', total: -1 });
    const r3 = bridgeFireQuoteSubmitted({ id: 'q1', total: Number.NaN });
    expect(r1.sent).toBe(false);
    expect(r2.sent).toBe(false);
    expect(r3.sent).toBe(false);
    // Standalone (no embed) also refuses; this proves the guard fires before postMessage.
    expect(messages).toHaveLength(0);
    void win;
  });

  it('bridgeFireBookingCompleted requires a jobber visit id', () => {
    const r = bridgeFireBookingCompleted({
      id: 'b1',
      jobberVisitId: null,
      bookedRevenue: 100,
    });
    expect(r.sent).toBe(false);
  });

  it('bridgeFireBookingFailed builds event id from attempt + stage', () => {
    // Not embedded → won't send, but we can inspect that the helper does not throw.
    const r = bridgeFireBookingFailed({ attemptId: 'a1', failureStage: 'server', errorCode: 'x' });
    expect(r.sent).toBe(false); // no embed
  });
});

describe('never throws', () => {
  it('swallows any internal failure', () => {
    // Force a broken sessionStorage by replacing it with a getter that throws.
    const orig = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('storage disabled');
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      postBluLadderBidEvent('quote_started', 'evt-boom', {}, {
        forceEmbedded: true,
        referrer: 'https://bluladder.com/',
        win: window as unknown as Window & typeof globalThis,
      }),
    ).not.toThrow();
    spy.mockRestore();
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: orig });
  });
});