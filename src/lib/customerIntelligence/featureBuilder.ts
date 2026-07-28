import type { CustomerFeatureSnapshot, ServiceKey } from './recommendationEngine';

export interface TimelineEvent {
  organizationId: string;
  canonicalEventId: string;
  eventType: string;
  eventAt: string;
  valueSemantics: 'revenue' | 'non_revenue';
  serviceKey?: ServiceKey | null;
  amount?: number | null;
  status?: string | null;
  channel?: string | null;
  city?: string | null;
  payload?: Record<string, unknown>;
}

export interface BuiltFeatureSnapshot extends CustomerFeatureSnapshot {
  quoteCount: number;
  bookingCount: number;
  preferredChannel: string | null;
  primaryCity: string | null;
  averageTicket: number;
  dataQuality: {
    eventCount: number;
    completedEventCount: number;
    historicalCoverageDays: number;
    sparse: boolean;
    excludedReason: string | null;
  };
}

const COMPLETED_TYPES = new Set(['job_completed', 'service_completed']);
const QUOTE_TYPES = new Set(['quote_created', 'quote_sent', 'quote_accepted', 'quote_declined']);
const BOOKING_TYPES = new Set(['booking_created', 'visit_scheduled']);
const CANCELLATION_TYPES = new Set(['booking_cancelled', 'visit_cancelled']);
const COMPLAINT_TYPES = new Set(['complaint', 'damage_claim', 'refund_request', 'legal_escalation', 'safety_escalation']);

function seasonFor(date: Date): CustomerFeatureSnapshot['season'] {
  const month = date.getUTCMonth() + 1;
  if (month <= 2 || month === 12) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'fall';
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.floor((later.getTime() - earlier.getTime()) / 86_400_000));
}

function mostCommon(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildCustomerFeatureSnapshot(args: {
  organizationId: string;
  featureVersion: string;
  asOf: string;
  events: TimelineEvent[];
  archivedStatus: 'active' | 'archived';
  complaintLookbackDays?: number;
  cancellationLookbackDays?: number;
}): BuiltFeatureSnapshot {
  if (!args.organizationId || args.events.some((event) => event.organizationId !== args.organizationId)) {
    throw new Error('organization_lineage_mismatch');
  }
  const canonicalIds = new Set(args.events.map((event) => event.canonicalEventId));
  if (canonicalIds.size !== args.events.length) {
    throw new Error('duplicate_canonical_event');
  }
  const asOfDate = new Date(args.asOf);
  const events = args.events
    .filter((event) => new Date(event.eventAt) <= asOfDate)
    .sort((a, b) =>
      new Date(a.eventAt).getTime() - new Date(b.eventAt).getTime()
      || a.canonicalEventId.localeCompare(b.canonicalEventId)
    );

  const completed = events.filter((event) => COMPLETED_TYPES.has(event.eventType));
  const quotes = events.filter((event) => QUOTE_TYPES.has(event.eventType));
  const bookings = events.filter((event) => BOOKING_TYPES.has(event.eventType));
  const cancellations = events.filter((event) => CANCELLATION_TYPES.has(event.eventType));

  const serviceDates = new Map<ServiceKey, Date[]>();
  const serviceCounts: Partial<Record<ServiceKey, number>> = {};
  const revenueEvents = events.filter((event) =>
    event.valueSemantics === 'revenue'
    && typeof event.amount === 'number'
    && Number.isFinite(event.amount)
    && event.amount > 0
  );
  const lifetimeValue = revenueEvents.reduce((total, event) => total + (event.amount ?? 0), 0);

  for (const event of completed) {
    if (event.serviceKey) {
      serviceCounts[event.serviceKey] = (serviceCounts[event.serviceKey] ?? 0) + 1;
      const dates = serviceDates.get(event.serviceKey) ?? [];
      dates.push(new Date(event.eventAt));
      serviceDates.set(event.serviceKey, dates);
    }
  }

  const serviceLastCompletedAt: Partial<Record<ServiceKey, string>> = {};
  const inferredServiceCadenceDays: Partial<Record<ServiceKey, number>> = {};
  for (const [serviceKey, dates] of serviceDates) {
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());
    serviceLastCompletedAt[serviceKey] = sortedDates[sortedDates.length - 1].toISOString();
    const intervals: number[] = [];
    for (let index = 1; index < sortedDates.length; index += 1) {
      intervals.push(daysBetween(sortedDates[index], sortedDates[index - 1]));
    }
    const cadence = median(intervals.filter((days) => days >= 14 && days <= 1825));
    if (cadence != null) inferredServiceCadenceDays[serviceKey] = cadence;
  }

  const lastCompletedAt = completed.length ? new Date(completed[completed.length - 1].eventAt) : null;
  const complaintLookback = args.complaintLookbackDays ?? 120;
  const cancellationLookback = args.cancellationLookbackDays ?? 90;
  const recentComplaint = events.some((event) =>
    COMPLAINT_TYPES.has(event.eventType)
    && daysBetween(asOfDate, new Date(event.eventAt)) <= complaintLookback,
  );
  const recentCancellation = cancellations.some((event) =>
    daysBetween(asOfDate, new Date(event.eventAt)) <= cancellationLookback,
  );

  const earliest = events.length ? new Date(events[0].eventAt) : asOfDate;
  const paidAmounts = revenueEvents
    .map((event) => event.amount)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  const fingerprintInput = events.map((event) => ({
    canonicalEventId: event.canonicalEventId,
    eventAt: event.eventAt,
    eventType: event.eventType,
    serviceKey: event.serviceKey ?? null,
    amount: event.amount ?? null,
    valueSemantics: event.valueSemantics,
  }));

  return {
    organizationId: args.organizationId,
    featureVersion: args.featureVersion,
    inputFingerprint: fingerprint(JSON.stringify(fingerprintInput)),
    asOf: asOfDate.toISOString(),
    lifetimeValue: Number(lifetimeValue.toFixed(2)),
    completedJobCount: completed.length,
    quoteCount: quotes.length,
    bookingCount: bookings.length,
    cancellationCount: cancellations.length,
    averageTicket: paidAmounts.length ? Number((lifetimeValue / paidAmounts.length).toFixed(2)) : 0,
    daysSinceLastCompleted: lastCompletedAt ? daysBetween(asOfDate, lastCompletedAt) : null,
    serviceCounts,
    serviceLastCompletedAt,
    inferredServiceCadenceDays,
    recentComplaint,
    recentCancellation,
    season: seasonFor(asOfDate),
    archivedStatus: args.archivedStatus,
    preferredChannel: mostCommon(events.map((event) => event.channel).filter((value): value is string => !!value)),
    primaryCity: mostCommon(events.map((event) => event.city).filter((value): value is string => !!value)),
    dataQuality: {
      eventCount: events.length,
      completedEventCount: completed.length,
      historicalCoverageDays: daysBetween(asOfDate, earliest),
      sparse: events.length < 5 || completed.length < 2,
      excludedReason: args.archivedStatus === 'archived' ? 'archived_jobber_client' : null,
    },
  };
}
