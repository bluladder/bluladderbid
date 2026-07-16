/**
 * BluLadder Bid → BluLadder.com iframe analytics bridge — SENDER side.
 *
 * Companion to the receiver in the marketing project
 * (src/lib/bluladderBidBridge.ts / BluLadderBidOverlay.tsx).
 *
 * See docs/bluladder-bid-postmessage-sender.md for the full contract.
 *
 * This module NEVER throws into a caller. Every public entry point is
 * wrapped in try/catch and returns a boolean; a failure here must never
 * interrupt quoting or booking. It does not fire any Meta Pixel events —
 * Meta ownership stays in src/lib/attribution/metaPixel.ts.
 */

import { readAttribution, getOrCreateSourceSessionId } from '@/lib/attribution/attribution';

/* ------------------------------- Types -------------------------------- */

export type BridgeEvent =
  | 'quote_started'
  | 'quote_submitted'
  | 'booking_completed'
  | 'booking_failed';

const BRIDGE_EVENTS: readonly BridgeEvent[] = [
  'quote_started',
  'quote_submitted',
  'booking_completed',
  'booking_failed',
];

/** Approved payload keys — anything else is dropped before send. */
const APPROVED_PAYLOAD_KEYS = new Set<string>([
  'source_session_id',
  'landing_page_slug',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'service_slug',
  'service_slugs',
  'quote_id',
  'quote_value',
  'booking_id',
  'booking_value',
  'currency',
  'failure_stage',
  'error_code',
]);

export const APPROVED_SERVICE_SLUGS = new Set<string>([
  'window-cleaning',
  'house-wash',
  'driveway-cleaning',
  'gutter-cleaning',
  'roof-wash',
  'roof-cleaning',
  'solar-panel-cleaning',
  'screen-repair',
]);

/** Production parent origins that are always allowed. */
const PRODUCTION_PARENT_ORIGINS = [
  'https://bluladder.com',
  'https://www.bluladder.com',
] as const;

/* ---------------------------- Origin allowlist ---------------------------- */

function readEnvAllowlist(): string[] {
  try {
    const raw =
      (typeof import.meta !== 'undefined' &&
        (import.meta as unknown as { env?: Record<string, string | undefined> }).env
          ?.VITE_BID_ALLOWED_PARENT_ORIGINS) ||
      '';
    if (!raw) return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isValidOriginString(origin: string): boolean {
  if (!origin || typeof origin !== 'string') return false;
  if (origin === '*' || origin === 'null') return false;
  try {
    const u = new URL(origin);
    // Must be exactly protocol + host, no path/search/hash.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    if (u.pathname !== '/' && u.pathname !== '') return false;
    if (u.search || u.hash) return false;
    return u.origin === origin;
  } catch {
    return false;
  }
}

/** Return the full allowlist (production + validated env preview origins). */
export function getAllowedParentOrigins(): string[] {
  const env = readEnvAllowlist().filter(isValidOriginString);
  return Array.from(new Set([...PRODUCTION_PARENT_ORIGINS, ...env]));
}

/**
 * Resolve the parent origin using ONLY the allowlist. Returns null when
 * we should not post a message.
 *
 * Order:
 *   1. `parent_origin` query param, IF it exactly matches the allowlist.
 *   2. Origin parsed from `document.referrer`, IF it exactly matches.
 *   3. Otherwise null.
 */
export function resolveParentOrigin(
  opts: {
    parentOriginParam?: string | null;
    referrer?: string;
    allowlist?: string[];
  } = {},
): string | null {
  const allow = new Set(opts.allowlist ?? getAllowedParentOrigins());
  const param = opts.parentOriginParam?.trim();
  if (param) {
    if (isValidOriginString(param) && allow.has(param)) return param;
    // A supplied but unapproved parent_origin is IGNORED — do not fall through
    // silently to referrer here either; a caller that supplies a bad hint has
    // effectively told us to drop the message. We deliberately DO still allow
    // referrer-based resolution below because a legitimate embed may simply
    // omit the hint.
  }
  const ref = opts.referrer ?? (typeof document !== 'undefined' ? document.referrer : '');
  if (ref) {
    try {
      const u = new URL(ref);
      const origin = u.origin;
      if (isValidOriginString(origin) && allow.has(origin)) return origin;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/* -------------------------------- Embed mode ------------------------------- */

export function isEmbedModeFromParams(params: URLSearchParams | null | undefined): boolean {
  if (!params) return false;
  const v = params.get('embed');
  return v === 'true' || v === '1';
}

function isActuallyEmbedded(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.parent === window) return false;
    if (typeof URLSearchParams === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    return isEmbedModeFromParams(params);
  } catch {
    return false;
  }
}

/* ------------------------------ Dedup store ------------------------------- */

const DEDUP_KEY = 'bl_bid_sender_seen_event_ids_v1';
const DEDUP_MAX = 200;

function readDedup(): string[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.sessionStorage.getItem(DEDUP_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((v) => typeof v === 'string') as string[]) : [];
  } catch {
    return [];
  }
}
function writeDedup(list: string[]): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(DEDUP_KEY, JSON.stringify(list.slice(-DEDUP_MAX)));
  } catch {
    /* noop */
  }
}
export function hasSentBridgeEvent(eventId: string): boolean {
  return readDedup().includes(eventId);
}
function markBridgeEventSent(eventId: string): void {
  const list = readDedup();
  if (!list.includes(eventId)) {
    list.push(eventId);
    writeDedup(list);
  }
}

/* ----------------------------- Payload sanitize ---------------------------- */

const LOOKS_LIKE_EMAIL = /@.+\.[a-z]{2,}/i;
const LOOKS_LIKE_PHONE = /^\+?\d[\d\s().-]{8,}$/;

function sanitizeStringValue(v: string): string | undefined {
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > 200) return undefined;
  if (LOOKS_LIKE_EMAIL.test(trimmed)) return undefined;
  if (LOOKS_LIKE_PHONE.test(trimmed)) return undefined;
  return trimmed;
}

function sanitizeMoney(v: unknown): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 999999.99) return undefined;
  // Round to 2 decimals.
  return Math.round(v * 100) / 100;
}

function sanitizeServiceSlug(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const cleaned = sanitizeStringValue(v);
  if (!cleaned) return undefined;
  return APPROVED_SERVICE_SLUGS.has(cleaned) ? cleaned : undefined;
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, raw] of Object.entries(payload)) {
    if (!APPROVED_PAYLOAD_KEYS.has(k)) continue;
    if (raw === undefined || raw === null) continue;

    if (k === 'quote_value' || k === 'booking_value') {
      const money = sanitizeMoney(raw);
      if (money !== undefined) out[k] = money;
      continue;
    }
    if (k === 'currency') {
      // Force USD; anything else is dropped.
      if (typeof raw === 'string' && raw.toUpperCase() === 'USD') out.currency = 'USD';
      continue;
    }
    if (k === 'service_slug') {
      const slug = sanitizeServiceSlug(raw);
      if (slug) out.service_slug = slug;
      continue;
    }
    if (k === 'service_slugs') {
      if (!Array.isArray(raw)) continue;
      const list = raw
        .map((s) => sanitizeServiceSlug(s))
        .filter((s): s is string => !!s)
        .slice(0, 20);
      if (list.length) out.service_slugs = Array.from(new Set(list));
      continue;
    }
    if (typeof raw === 'string') {
      const clean = sanitizeStringValue(raw);
      if (clean) out[k] = clean;
      continue;
    }
    // Any non-string, non-approved-shape value is dropped.
  }
  return out;
}

/* -------------------------- Attribution merge ------------------------- */

/**
 * Merge first-touch attribution + source_session_id into the payload.
 *
 * PRECEDENCE: for attribution-scoped keys ONLY, the STORED first-touch value
 * wins over any later caller-supplied value. This preserves original paid /
 * campaign / QR / typed attribution against later `direct_unknown` or blank
 * overwrites. Event-specific keys (quote_id, booking_id, quote_value,
 * booking_value, service_slug, service_slugs, failure_stage, error_code) are
 * NEVER touched here and continue to come from the event caller.
 */
function mergeFirstTouch(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...payload };
  try {
    const attribution = readAttribution();
    const first = attribution.first_touch ?? {};
    // First-touch WINS: overwrite any caller-supplied attribution value with
    // the stored first-touch value when the stored value is a non-blank
    // string. Blank / missing stored values leave the caller-supplied value
    // in place, so genuinely-new attribution can still populate empty slots.
    const firstTouchWins = (key: string, value: unknown) => {
      if (value === undefined || value === null || value === '') return;
      out[key] = value;
    };
    firstTouchWins('source_session_id', attribution.source_session_id);
    firstTouchWins('utm_source', first.utm_source);
    firstTouchWins('utm_medium', first.utm_medium);
    firstTouchWins('utm_campaign', first.utm_campaign);
    firstTouchWins('utm_content', first.utm_content);
    firstTouchWins('utm_term', first.utm_term);
    firstTouchWins('fbclid', first.fbclid ?? attribution.fbclid);
    firstTouchWins('landing_page_slug', first.landing_page_slug ?? attribution.landing_page_slug);
  } catch {
    /* attribution is best-effort; never block */
  }
  return out;
}

/* --------------------------- Core sender API --------------------------- */

export interface PostBluLadderBidEventResult {
  sent: boolean;
  reason?:
    | 'not_embedded'
    | 'no_parent_origin'
    | 'invalid_event'
    | 'invalid_event_id'
    | 'already_sent'
    | 'exception';
}

/**
 * The one and only sender entry point. Every event mirror in the app MUST
 * route through this function. Never call window.parent.postMessage directly.
 */
export function postBluLadderBidEvent(
  event: BridgeEvent,
  eventId: string,
  payload: Record<string, unknown>,
  opts: {
    /** Injected for tests. Defaults to `window`. */
    win?: Window & typeof globalThis;
    /** Injected for tests. Defaults to actual embed detection. */
    forceEmbedded?: boolean;
    parentOriginParam?: string | null;
    referrer?: string;
    now?: () => Date;
  } = {},
): PostBluLadderBidEventResult {
  try {
    if (!BRIDGE_EVENTS.includes(event)) return { sent: false, reason: 'invalid_event' };
    if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200) {
      return { sent: false, reason: 'invalid_event_id' };
    }

    const win = opts.win ?? (typeof window !== 'undefined' ? window : undefined);
    if (!win) return { sent: false, reason: 'not_embedded' };

    const embedded =
      opts.forceEmbedded !== undefined
        ? opts.forceEmbedded
        : (() => {
            try {
              return win.parent !== win && isEmbedModeFromParams(new URLSearchParams(win.location.search));
            } catch {
              return false;
            }
          })();
    if (!embedded) return { sent: false, reason: 'not_embedded' };

    if (hasSentBridgeEvent(eventId)) return { sent: false, reason: 'already_sent' };

    const targetOrigin = resolveParentOrigin({
      parentOriginParam:
        opts.parentOriginParam ??
        (() => {
          try {
            return new URLSearchParams(win.location.search).get('parent_origin');
          } catch {
            return null;
          }
        })(),
      referrer: opts.referrer ?? (typeof document !== 'undefined' ? document.referrer : ''),
    });
    if (!targetOrigin) return { sent: false, reason: 'no_parent_origin' };

    const merged = mergeFirstTouch(payload);
    const cleanPayload = sanitizePayload(merged);
    // Always tag currency USD on value-carrying events.
    if (cleanPayload.quote_value !== undefined || cleanPayload.booking_value !== undefined) {
      cleanPayload.currency = 'USD';
    }

    const message = {
      type: 'bluladder-bid-event' as const,
      version: 1 as const,
      event,
      event_id: eventId,
      timestamp: (opts.now?.() ?? new Date()).toISOString(),
      payload: cleanPayload,
    };

    markBridgeEventSent(eventId);
    win.parent.postMessage(message, targetOrigin);
    return { sent: true };
  } catch {
    return { sent: false, reason: 'exception' };
  }
}

/* --------------------- Semantic event helpers --------------------- */

function sessionId(): string {
  try {
    return getOrCreateSourceSessionId();
  } catch {
    return 'unknown';
  }
}

export function bridgeFireQuoteStarted(
  ctx: { preselectService?: string | null; enabledServiceSlugs?: string[] } = {},
): PostBluLadderBidEventResult {
  const eventId = `quote_started_${sessionId()}`;
  const payload: Record<string, unknown> = {};
  if (ctx.preselectService) payload.service_slug = ctx.preselectService;
  if (ctx.enabledServiceSlugs?.length) payload.service_slugs = ctx.enabledServiceSlugs;
  return postBluLadderBidEvent('quote_started', eventId, payload);
}

export function bridgeFireQuoteSubmitted(quote: {
  id: string;
  total: number;
  serviceSlugs?: string[];
}): PostBluLadderBidEventResult {
  if (!quote || !quote.id || typeof quote.total !== 'number' || !Number.isFinite(quote.total) || quote.total <= 0) {
    return { sent: false, reason: 'invalid_event_id' };
  }
  const eventId = `quote_submitted_${quote.id}`;
  return postBluLadderBidEvent('quote_submitted', eventId, {
    quote_id: quote.id,
    quote_value: quote.total,
    currency: 'USD',
    service_slugs: quote.serviceSlugs,
  });
}

export function bridgeFireBookingCompleted(booking: {
  id: string;
  jobberVisitId: string | null | undefined;
  bookedRevenue: number;
  serviceSlugs?: string[];
}): PostBluLadderBidEventResult {
  if (!booking || !booking.id || !booking.jobberVisitId) {
    return { sent: false, reason: 'invalid_event_id' };
  }
  if (typeof booking.bookedRevenue !== 'number' || !Number.isFinite(booking.bookedRevenue)) {
    return { sent: false, reason: 'invalid_event_id' };
  }
  const eventId = `booking_completed_${booking.id}`;
  return postBluLadderBidEvent('booking_completed', eventId, {
    booking_id: booking.id,
    booking_value: booking.bookedRevenue,
    currency: 'USD',
    service_slugs: booking.serviceSlugs,
  });
}

export function bridgeFireBookingFailed(input: {
  attemptId: string;
  failureStage: 'validation' | 'server' | 'jobber' | 'conflict' | 'unknown';
  errorCode?: string;
}): PostBluLadderBidEventResult {
  if (!input || !input.attemptId || !input.failureStage) {
    return { sent: false, reason: 'invalid_event_id' };
  }
  const eventId = `booking_failed_${input.attemptId}_${input.failureStage}`;
  const payload: Record<string, unknown> = { failure_stage: input.failureStage };
  if (input.errorCode) payload.error_code = input.errorCode.slice(0, 60);
  return postBluLadderBidEvent('booking_failed', eventId, payload);
}

/* --------------------------------- Testing --------------------------------- */

export function __resetBridgeDedupForTests(): void {
  try {
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(DEDUP_KEY);
  } catch {
    /* noop */
  }
}

/** Internal — exposed for unit tests only. */
export const __internal = {
  sanitizePayload,
  mergeFirstTouch,
  isValidOriginString,
  BRIDGE_EVENTS,
};