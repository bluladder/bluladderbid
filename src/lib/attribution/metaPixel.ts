/**
 * Meta Pixel wrapper — thin, deduplicated, PII-scrubbed.
 *
 * Firing rules (enforced here so callers cannot bypass them):
 *  - Lead: only after quote/contact persistence returns a durable quote id.
 *  - InitiateCheckout: only from the explicit scheduling-intake CTA with a
 *    current firm canonical quote.
 *  - Schedule: only when a Jobber booking succeeded AND a jobber_visit_id
 *    is present.
 *
 * Deduplication:
 *  - Every event carries a canonical deterministic eventID suitable for a
 *    future browser/server Conversions API pair.
 *  - We record fired eventIDs in localStorage so refreshes, back/forward
 *    navigation, rerenders, and idempotent replay never fire the same event
 *    twice from the same browser. Meta itself dedupes across browser+server
 *    by eventID.
 *
 * Revenue is ONLY read from the passed canonical quote/booking objects,
 * never from the URL, DOM, or user input.
 */

import { readAttribution } from './attribution';
import { isMetaTrackingDenied } from './metaConsent';
import { buildMetaEventId } from './metaEventContract';

const DEDUP_KEY = 'bluladder_meta_events_fired';
const LEAD_SOURCE = 'fb_window_cleaning_offer_bid';

type FbqFn = ((
  cmd: 'track' | 'trackCustom' | 'init',
  eventName: string,
  params?: Record<string, unknown>,
  options?: { eventID?: string },
) => void) & { queue?: unknown };

declare global {
  interface Window {
    fbq?: FbqFn;
    _fbq?: FbqFn;
  }
}

function readDedup(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DEDUP_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeDedup(set: Set<string>): void {
  try {
    window.localStorage.setItem(DEDUP_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* noop */
  }
}

export function hasFired(eventId: string): boolean {
  if (typeof window === 'undefined') return false;
  return readDedup().has(eventId);
}
function markFired(eventId: string): void {
  if (typeof window === 'undefined') return;
  const s = readDedup();
  s.add(eventId);
  writeDedup(s);
}

// PII fields that must NEVER be sent in a Meta event payload.
const PII_KEYS = new Set([
  'email',
  'phone',
  'firstName',
  'lastName',
  'name',
  'address',
  'street',
  'streetAddress',
  'customerEmail',
  'customerPhone',
  'customerName',
  'firstname',
  'lastname',
]);

function scrubPii<T extends Record<string, unknown>>(params: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (PII_KEYS.has(k)) continue;
    if (typeof v === 'string') {
      // Extra guard: skip anything that clearly looks like an email or a 10-digit phone.
      if (/@.+\.[a-z]{2,}/i.test(v)) continue;
      if (/^\+?\d[\d\s().-]{8,}$/.test(v)) continue;
    }
    out[k] = v;
  }
  return out;
}

function fbqReady(): FbqFn | null {
  if (typeof window === 'undefined') return null;
  return window.fbq ?? null;
}

function track(eventName: string, params: Record<string, unknown>, eventId: string): boolean {
  if (isMetaTrackingDenied()) return false;
  if (hasFired(eventId)) return false;
  const fn = fbqReady();
  if (!fn) return false;
  const scrubbed = scrubPii(params);
  try {
    fn('track', eventName, scrubbed, { eventID: eventId });
    markFired(eventId);
    return true;
  } catch {
    return false;
  }
}

/* ---------- Quote / Booking canonical shapes ---------- */

export interface CanonicalQuoteForPixel {
  /** Durable quote id for Lead; canonical fingerprint for InitiateCheckout. */
  id: string;
  /** Server-authoritative total. Must be a number. */
  quoted_total: number;
  service_count: number;
  services_selected: string[];
  city?: string;
  zip_code?: string;
  /** Must be true for the Lead event to fire. */
  firm: boolean;
}

export interface PersistedQuoteForPixel extends CanonicalQuoteForPixel {
  /** Proves the caller received a durable quote id from save-quote. */
  persisted: boolean;
}

export interface CanonicalBookingForPixel {
  id: string;
  jobber_visit_id: string | null | undefined;
  booked_revenue: number;
  service_count: number;
  services_selected: string[];
  city?: string;
  zip_code?: string;
}

function validCanonicalQuote(quote: CanonicalQuoteForPixel): boolean {
  if (!quote || !quote.firm) return false;
  if (!quote.id || typeof quote.quoted_total !== 'number' || !Number.isFinite(quote.quoted_total)) {
    return false;
  }
  if (quote.quoted_total <= 0) return false;
  return true;
}

function quoteParams(quote: CanonicalQuoteForPixel): Record<string, unknown> {
  const attribution = readAttribution();
  return {
    value: quote.quoted_total,
    currency: 'USD',
    content_name: 'Instant Quote',
    content_category: 'Home Services',
    service_count: quote.service_count,
    services_selected: quote.services_selected,
    city: quote.city,
    zip_code: quote.zip_code,
    lead_source: LEAD_SOURCE,
    landing_page_slug: attribution.landing_page_slug,
    fbclid: attribution.fbclid,
    utm_source: attribution.first_touch.utm_source,
    utm_medium: attribution.first_touch.utm_medium,
    utm_campaign: attribution.first_touch.utm_campaign,
    utm_content: attribution.first_touch.utm_content,
    utm_term: attribution.first_touch.utm_term,
  };
}

export function fireLead(quote: PersistedQuoteForPixel): boolean {
  if (!quote?.persisted || !validCanonicalQuote(quote)) return false;
  const eventId = buildMetaEventId('Lead', quote.id);
  if (!eventId) return false;
  return track('Lead', quoteParams(quote), eventId);
}

export function fireInitiateCheckout(quote: CanonicalQuoteForPixel): boolean {
  if (!validCanonicalQuote(quote)) return false;
  const eventId = buildMetaEventId('InitiateCheckout', quote.id);
  if (!eventId) return false;
  return track(
    'InitiateCheckout',
    {
      ...quoteParams(quote),
      content_name: 'One-Time Service Scheduling',
    },
    eventId,
  );
}

export function fireSchedule(booking: CanonicalBookingForPixel): boolean {
  if (!booking || !booking.id) return false;
  if (!booking.jobber_visit_id) return false;
  if (typeof booking.booked_revenue !== 'number' || !Number.isFinite(booking.booked_revenue)) {
    return false;
  }
  if (booking.booked_revenue <= 0) return false;
  const eventId = buildMetaEventId('Schedule', booking.id);
  if (!eventId) return false;
  const attribution = readAttribution();
  return track(
    'Schedule',
    {
      value: booking.booked_revenue,
      currency: 'USD',
      service_count: booking.service_count,
      services_selected: booking.services_selected,
      city: booking.city,
      zip_code: booking.zip_code,
      lead_source: LEAD_SOURCE,
      landing_page_slug: attribution.landing_page_slug,
    },
    eventId,
  );
}

/** Testing hook. */
export function __resetPixelDedupForTests(): void {
  try {
    window.localStorage.removeItem(DEDUP_KEY);
  } catch {
    /* noop */
  }
}

/** Deterministic quote id from the canonical firm-quote fields. */
export function deriveQuoteFingerprint(input: {
  ruleVersion: number | null | undefined;
  engineVersion: string | null | undefined;
  total: number;
  services: string[];
  session: string;
}): string {
  const key = JSON.stringify({
    r: input.ruleVersion ?? null,
    e: input.engineVersion ?? null,
    t: Math.round(input.total * 100),
    s: [...input.services].sort(),
    sess: input.session,
  });
  // Tiny djb2 hash — deterministic and short.
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = (h * 33) ^ key.charCodeAt(i);
  return `q_${(h >>> 0).toString(36)}`;
}

/** Compatibility alias retained for existing non-Meta callers/tests. */
export const deriveQuoteId = deriveQuoteFingerprint;
