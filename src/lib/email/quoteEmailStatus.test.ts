import { describe, it, expect } from 'vitest';
import { decideQuoteEmailStatus } from './quoteEmailStatus';

describe('decideQuoteEmailStatus', () => {
  it('2xx WITH provider id → accepted (not "sent", not "delivered")', () => {
    expect(decideQuoteEmailStatus({ ok: true, providerMessageId: 'resend-msg-123' })).toBe('accepted');
  });
  it('2xx WITHOUT provider id → failed', () => {
    expect(decideQuoteEmailStatus({ ok: true, providerMessageId: null })).toBe('failed');
  });
  it('pre-send suppression → suppressed', () => {
    expect(decideQuoteEmailStatus({
      ok: false, providerMessageId: null, failureCategory: 'suppressed',
    })).toBe('suppressed');
  });
  it('any other failure → failed', () => {
    for (const cat of ['sender_not_verified','invalid_recipient','rate_limited','network_error','provider_rejected']) {
      expect(decideQuoteEmailStatus({ ok: false, providerMessageId: null, failureCategory: cat }))
        .toBe('failed');
    }
  });
});
