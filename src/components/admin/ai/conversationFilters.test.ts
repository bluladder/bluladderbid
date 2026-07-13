import { describe, it, expect } from 'vitest';
import { matchesFilter, isAbandoned, type ConvoLike } from './conversationFilters';

const now = Date.parse('2026-07-13T12:00:00Z');
const fresh = new Date(now - 60_000).toISOString();
const old = new Date(now - 25 * 3600_000).toISOString();

describe('conversation dashboard filters', () => {
  it('all matches everything', () => {
    expect(matchesFilter({ conversation_state: 'pricing' }, 'all', now)).toBe(true);
  });

  it('needs_attention filter excludes resolved', () => {
    expect(matchesFilter({ needs_attention: true }, 'needs_attention', now)).toBe(true);
    expect(matchesFilter({ needs_attention: true, resolved: true }, 'needs_attention', now)).toBe(false);
  });

  it('booked filter matches only booked state', () => {
    expect(matchesFilter({ conversation_state: 'booked' }, 'booked', now)).toBe(true);
    expect(matchesFilter({ conversation_state: 'pricing' }, 'booked', now)).toBe(false);
  });

  it('abandoned requires a stalled active state past 24h', () => {
    expect(isAbandoned({ conversation_state: 'pricing', last_activity_at: old }, now)).toBe(true);
    expect(isAbandoned({ conversation_state: 'pricing', last_activity_at: fresh }, now)).toBe(false);
    expect(isAbandoned({ conversation_state: 'booked', last_activity_at: old }, now)).toBe(false);
    expect(isAbandoned({ conversation_state: 'callback_requested', last_activity_at: old }, now)).toBe(false);
  });

  it('active excludes abandoned and resolved', () => {
    expect(matchesFilter({ conversation_state: 'pricing', last_activity_at: fresh }, 'active', now)).toBe(true);
    expect(matchesFilter({ conversation_state: 'pricing', last_activity_at: old }, 'active', now)).toBe(false);
    expect(matchesFilter({ conversation_state: 'pricing', last_activity_at: fresh, resolved: true }, 'active', now)).toBe(false);
  });

  it('awaiting_confirmation maps to the deterministic state', () => {
    expect(matchesFilter({ conversation_state: 'awaiting_booking_confirmation' } as ConvoLike, 'awaiting_confirmation', now)).toBe(true);
  });

  it('staff takeover and manual review map directly', () => {
    expect(matchesFilter({ conversation_state: 'staff_takeover' }, 'staff_takeover', now)).toBe(true);
    expect(matchesFilter({ conversation_state: 'manual_review' }, 'manual_review', now)).toBe(true);
  });
});
