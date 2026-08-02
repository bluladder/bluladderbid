export type CanonicalMetaEventName = 'Lead' | 'InitiateCheckout' | 'Schedule';

const EVENT_ID_VERSION = 'v1';
const EVENT_SLUGS: Record<CanonicalMetaEventName, string> = {
  Lead: 'lead',
  InitiateCheckout: 'initiate_checkout',
  Schedule: 'schedule',
};

/**
 * Canonical browser/server deduplication contract.
 *
 * A future Conversions API sender must use this exact function/format with the
 * same event name and durable entity identifier supplied by the browser.
 */
export function buildMetaEventId(
  eventName: CanonicalMetaEventName,
  entityId: string,
): string | null {
  const normalizedEntityId = entityId.trim();
  if (!normalizedEntityId) return null;
  return `blb_${EVENT_ID_VERSION}_${EVENT_SLUGS[eventName]}_${normalizedEntityId}`;
}
