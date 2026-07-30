import { describe, expect, it } from 'vitest';
import { buildCustomerFeatureSnapshot, type TimelineEvent } from './featureBuilder';

const DFW = 'b1addf00-0000-4000-8000-000000000001';
const OREGON = 'b1addf00-0000-4000-8000-000000000002';
let eventSequence = 0;
const event = (
  eventValue: Partial<TimelineEvent> & Pick<TimelineEvent, 'eventType' | 'eventAt'>,
): TimelineEvent => ({
  organizationId: DFW,
  canonicalEventId: `event-${eventSequence += 1}`,
  valueSemantics: 'non_revenue' as const,
  ...eventValue,
});
const base = {
  organizationId: DFW,
  featureVersion: 'customer-features-v1',
  archivedStatus: 'active' as const,
};

describe('buildCustomerFeatureSnapshot', () => {
  it('builds reproducible point-in-time customer features without future leakage', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [
        event({ eventType: 'service_completed', eventAt: '2025-01-01T00:00:00Z', serviceKey: 'window_cleaning', amount: 300, valueSemantics: 'revenue', channel: 'phone', city: 'McKinney' }),
        event({ eventType: 'service_completed', eventAt: '2025-07-01T00:00:00Z', serviceKey: 'window_cleaning', amount: 350, valueSemantics: 'revenue', channel: 'phone', city: 'McKinney' }),
        event({ eventType: 'quote_created', eventAt: '2026-01-01T00:00:00Z', channel: 'web', city: 'McKinney' }),
        event({ eventType: 'service_completed', eventAt: '2026-08-01T00:00:00Z', serviceKey: 'house_wash', amount: 500, valueSemantics: 'revenue' }),
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
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [
        event({ eventType: 'complaint', eventAt: '2026-07-01T00:00:00Z' }),
        event({ eventType: 'booking_cancelled', eventAt: '2026-06-15T00:00:00Z' }),
      ],
    });

    expect(snapshot.recentComplaint).toBe(true);
    expect(snapshot.recentCancellation).toBe(true);
  });

  it('marks sparse history conservatively', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [event({ eventType: 'quote_created', eventAt: '2026-07-01T00:00:00Z' })],
    });

    expect(snapshot.dataQuality.sparse).toBe(true);
    expect(snapshot.averageTicket).toBe(0);
    expect(snapshot.daysSinceLastCompleted).toBeNull();
  });

  it('fails closed on mixed-organization or duplicate canonical events', () => {
    const dfwEvent = event({ eventType: 'quote_created', eventAt: '2026-07-01T00:00:00Z' });
    expect(() => buildCustomerFeatureSnapshot({
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [dfwEvent, { ...dfwEvent, organizationId: OREGON, canonicalEventId: 'oregon-event' }],
    })).toThrow('organization_lineage_mismatch');
    expect(() => buildCustomerFeatureSnapshot({
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [dfwEvent, { ...dfwEvent }],
    })).toThrow('duplicate_canonical_event');
  });

  it('does not double count non-revenue lifecycle events', () => {
    const snapshot = buildCustomerFeatureSnapshot({
      ...base,
      asOf: '2026-07-27T00:00:00Z',
      events: [
        event({ eventType: 'service_completed', eventAt: '2026-07-01T00:00:00Z', amount: 300 }),
        event({ eventType: 'invoice_paid', eventAt: '2026-07-02T00:00:00Z', amount: 300, valueSemantics: 'revenue' }),
      ],
    });
    expect(snapshot.completedJobCount).toBe(1);
    expect(snapshot.lifetimeValue).toBe(300);
  });
});
