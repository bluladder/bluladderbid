import { describe, expect, it } from 'vitest';
import { buildCustomerFeatureSnapshot } from './featureBuilder';

describe('buildCustomerFeatureSnapshot', () => {
  it('builds reproducible point-in-time customer features without future leakage', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      asOf: '2026-07-27T00:00:00Z',
      events: [
        { eventType: 'service_completed', eventAt: '2025-01-01T00:00:00Z', serviceKey: 'window_cleaning', amount: 300, channel: 'phone', city: 'McKinney' },
        { eventType: 'service_completed', eventAt: '2025-07-01T00:00:00Z', serviceKey: 'window_cleaning', amount: 350, channel: 'phone', city: 'McKinney' },
        { eventType: 'quote_created', eventAt: '2026-01-01T00:00:00Z', channel: 'web', city: 'McKinney' },
        { eventType: 'service_completed', eventAt: '2026-08-01T00:00:00Z', serviceKey: 'house_wash', amount: 500 },
      ],
    });

    expect(snapshot.lifetimeValue).toBe(650);
    expect(snapshot.completedJobCount).toBe(2);
    expect(snapshot.serviceCounts.window_cleaning).toBe(2);
    expect(snapshot.serviceCounts.house_wash).toBeUndefined();
    expect(snapshot.inferredServiceCadenceDays.window_cleaning).toBe(181);
    expect(snapshot.preferredChannel).toBe('phone');
    expect(snapshot.primaryCity).toBe('McKinney');
  });

  it('sets complaint and cancellation safety flags from bounded lookbacks', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      asOf: '2026-07-27T00:00:00Z',
      events: [
        { eventType: 'complaint', eventAt: '2026-07-01T00:00:00Z' },
        { eventType: 'booking_cancelled', eventAt: '2026-06-15T00:00:00Z' },
      ],
    });

    expect(snapshot.recentComplaint).toBe(true);
    expect(snapshot.recentCancellation).toBe(true);
  });

  it('marks sparse history conservatively', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      asOf: '2026-07-27T00:00:00Z',
      events: [{ eventType: 'quote_created', eventAt: '2026-07-01T00:00:00Z' }],
    });

    expect(snapshot.dataQuality.sparse).toBe(true);
    expect(snapshot.averageTicket).toBe(0);
    expect(snapshot.daysSinceLastCompleted).toBeNull();
  });
});
