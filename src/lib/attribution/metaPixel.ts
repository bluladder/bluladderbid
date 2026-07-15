/**
 * Meta Pixel wrapper — thin, deduplicated, PII-scrubbed.
 *
 * Firing rules (enforced here so callers cannot bypass them):
 *  - Lead: only when a firm canonical server quote is present (quote id +
 *    numeric quoted_total).
 *  - Schedule: only when a Jobber booking succeeded AND a jobber_visit_id
 *    is present.
 *  - CompleteRegistration: only when Schedule's preconditions are met.
 *
 * Deduplication:
 *  - Every event carries a deterministic eventID.
 *  - We record fired eventIDs in localStorage so refreshes, back/forward
 *    navigation, rerenders, and idempotent replay never fire the same event
 *    twice from the same browser. Meta itself dedupes across browser+server
 *    by eventID.
 *
 * Revenue is ONLY read from the passed canonical quote/booking objects,
 * never from the URL, DOM, or user input.
 */

import { readAttribution } from './attribution';

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
  if (hasFired(eventId)) return false;
  const fn = fbqReady();
  const scrubbed = scrubPii(params);
  markFired(eventId);
  if (!fn) return true; // still marked; the pixel snippet may not be loaded in dev
  try {
    fn('track', eventName, scrubbed, { eventID: eventId });
  } catch {
    /* swallow */
  }
  return true;
}

/* ---------- Quote / Booking canonical shapes ---------- */

export interface CanonicalQuoteForPixel {
  /** A stable identifier for the firm quote. Any string works; the caller is
   *  responsible for making it deterministic per quote. */
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

export interface CanonicalBookingForPixel {
  id: string;
  jobber_visit_id: string | null | undefined;
  booked_revenue: number;
  service_count: number;
  services_selected: string[];
  city?: string;
  zip_code?: string;
}

export function fireLead(quote: CanonicalQuoteForPixel): boolean {
  if (!quote || !quote.firm) return false;
  if (!quote.id || typeof quote.quoted_total !== 'number' || !Number.isFinite(quote.quoted_total)) {
    return false;
  }
  if (quote.quoted_total <= 0) return false;
  const eventId = `lead_${quote.id}`;
  const attribution = readAttribution();
  return track(
    'Lead',
    {
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
      utm_source: attribution.first_touch.utm_source,
      utm_campaign: attribution.first_touch.utm_campaign,
      utm_content: attribution.first_touch.utm_content,
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
  const eventId = `schedule_${booking.id}`;
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

export function fireCompleteRegistration(booking: CanonicalBookingForPixel): boolean {
  if (!booking || !booking.id) return false;
  if (!booking.jobber_visit_id) return false;
  const eventId = `complete_${booking.id}_completeregistration`;
  return track(
    'CompleteRegistration',
    {
      content_name: 'Booking Confirmed',
      content_category: 'Home Services',
      service_count: booking.service_count,
      city: booking.city,
      zip_code: booking.zip_code,
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
export function deriveQuoteId(input: {
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
