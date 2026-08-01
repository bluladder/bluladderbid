/**
 * Attribution capture and persistence.
 *
 * Captures a whitelisted set of marketing parameters from the URL and stores
 * them so they survive across page navigations. Applies first-touch semantics:
 * a valid Meta / paid first-touch is NEVER overwritten by later direct
 * traffic. Direct traffic can populate a first-touch only when nothing has
 * been captured yet.
 *
 * NOTHING in this module trusts or persists PII (name, email, phone, street
 * address) and NOTHING here computes or accepts revenue. Revenue is a
 * server-side-only concern.
 */

import { isMetaTrackingDenied } from './metaConsent';

const WHITELIST = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'landing_page_slug',
  'referrer',
  'source_session_id',
  'fbp',
  'fbc',
] as const;

export type AttributionKey = (typeof WHITELIST)[number];

export type AttributionTouch = Partial<Record<AttributionKey, string>> & {
  captured_at?: string;
};

export interface AttributionState {
  source_session_id: string;
  first_touch: AttributionTouch;
  last_touch: AttributionTouch;
  landing_page_slug?: string;
  fbclid?: string;
  fbp?: string;
  fbc?: string;
  referrer?: string;
  self_reported_source?: string;
  self_reported_source_detail?: string;
}

const FIRST_TOUCH_KEY = 'bluladder_attribution_first_touch';
const LAST_TOUCH_KEY = 'bluladder_attribution_last_touch';
const SESSION_ID_KEY = 'bluladder_source_session_id';
const SELF_REPORTED_SOURCE_KEY = 'bluladder_self_reported_source';
const SELF_REPORTED_DETAIL_KEY = 'bluladder_self_reported_source_detail';

const MAX_LEN = 200;
const META_SOURCES = new Set(['facebook', 'fb', 'meta', 'instagram', 'ig']);

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(storage: Storage | undefined, key: string, val: string): void {
  try {
    storage?.setItem(key, val);
  } catch {
    /* noop */
  }
}

function localS(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}
function sessionS(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.sessionStorage;
}

function sanitize(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).slice(0, MAX_LEN).trim();
  if (!trimmed) return undefined;
  if (/@/.test(trimmed) && /\.[a-z]{2,}/i.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length >= 7 && /^\+?[\d\s().-]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function pickWhitelisted(source: URLSearchParams | Record<string, unknown>): AttributionTouch {
  const out: AttributionTouch = {};
  for (const key of WHITELIST) {
    const raw =
      source instanceof URLSearchParams
        ? key === 'fbp' || key === 'fbc'
          ? null
          : source.get(key)
        : ((source as Record<string, unknown>)[key] as string | undefined);
    const val = sanitize(raw);
    if (val) out[key] = val;
  }
  return out;
}

function hasAnyMeaningful(touch: AttributionTouch): boolean {
  return WHITELIST.some(
    (k) => k !== 'source_session_id' && k !== 'fbp' && k !== 'fbc' && !!touch[k],
  );
}

function isMetaTouch(touch: AttributionTouch): boolean {
  if (touch.fbclid) return true;
  const src = touch.utm_source?.toLowerCase();
  return !!src && META_SOURCES.has(src);
}

function readCookie(name: '_fbp' | '_fbc'): string | undefined {
  if (typeof document === 'undefined' || isMetaTrackingDenied()) return undefined;
  try {
    const prefix = `${name}=`;
    const raw = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length);
    return sanitize(raw ? decodeURIComponent(raw) : undefined);
  } catch {
    return undefined;
  }
}

function readMetaBrowserIds(): Pick<AttributionState, 'fbp' | 'fbc'> {
  return {
    fbp: readCookie('_fbp'),
    fbc: readCookie('_fbc'),
  };
}

function enrichTouchWithMetaIds(
  touch: AttributionTouch,
  ids: Pick<AttributionState, 'fbp' | 'fbc'>,
): AttributionTouch {
  return {
    ...touch,
    ...(ids.fbp ? { fbp: ids.fbp } : {}),
    ...(ids.fbc ? { fbc: ids.fbc } : {}),
  };
}

function readTouch(key: string): AttributionTouch | null {
  const raw = safeGet(localS(), key) ?? safeGet(sessionS(), key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return pickWhitelisted(parsed as Record<string, unknown>);
    return null;
  } catch {
    return null;
  }
}

export function getOrCreateSourceSessionId(): string {
  const existing = safeGet(localS(), SESSION_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `ss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  safeSet(localS(), SESSION_ID_KEY, id);
  return id;
}

export function setSelfReportedSource(source: string, detail?: string): void {
  const cleanSource = sanitize(source);
  const cleanDetail = sanitize(detail);
  if (!cleanSource) return;
  safeSet(localS(), SELF_REPORTED_SOURCE_KEY, cleanSource);
  if (cleanDetail) safeSet(localS(), SELF_REPORTED_DETAIL_KEY, cleanDetail);
  else {
    try { localS()?.removeItem(SELF_REPORTED_DETAIL_KEY); } catch { /* noop */ }
  }
}

export function captureAttribution(params: URLSearchParams): AttributionState {
  const incoming = pickWhitelisted(params);
  const metaIds = readMetaBrowserIds();
  if (!incoming.referrer && typeof document !== 'undefined' && document.referrer) {
    try {
      const url = new URL(document.referrer);
      incoming.referrer = sanitize(url.hostname);
    } catch {
      /* ignore */
    }
  }

  const sessionId = sanitize(incoming.source_session_id) ?? getOrCreateSourceSessionId();
  if (safeGet(localS(), SESSION_ID_KEY) !== sessionId) {
    safeSet(localS(), SESSION_ID_KEY, sessionId);
  }

  const existingFirst = readTouch(FIRST_TOUCH_KEY);
  let newFirst = existingFirst;

  const incomingHasSignal = hasAnyMeaningful(incoming);
  if (incomingHasSignal) {
    if (!existingFirst || !hasAnyMeaningful(existingFirst)) {
      newFirst = { ...incoming, captured_at: new Date().toISOString() };
    } else if (!isMetaTouch(existingFirst) && isMetaTouch(incoming)) {
      newFirst = { ...incoming, captured_at: new Date().toISOString() };
    }
  }

  if (newFirst) newFirst = enrichTouchWithMetaIds(newFirst, metaIds);

  if (newFirst && newFirst !== existingFirst) {
    safeSet(localS(), FIRST_TOUCH_KEY, JSON.stringify(newFirst));
  }

  const lastTouch: AttributionTouch = enrichTouchWithMetaIds(
    incomingHasSignal
      ? { ...incoming, captured_at: new Date().toISOString() }
      : readTouch(LAST_TOUCH_KEY) ?? {},
    metaIds,
  );
  if (incomingHasSignal || metaIds.fbp || metaIds.fbc) {
    safeSet(sessionS(), LAST_TOUCH_KEY, JSON.stringify(lastTouch));
  }

  return {
    source_session_id: sessionId,
    first_touch: newFirst ?? existingFirst ?? {},
    last_touch: lastTouch,
    landing_page_slug: (newFirst ?? existingFirst)?.landing_page_slug ?? incoming.landing_page_slug,
    fbclid: (newFirst ?? existingFirst)?.fbclid ?? incoming.fbclid,
    fbp: metaIds.fbp ?? (newFirst ?? existingFirst)?.fbp ?? lastTouch.fbp,
    fbc: metaIds.fbc ?? (newFirst ?? existingFirst)?.fbc ?? lastTouch.fbc,
    referrer: (newFirst ?? existingFirst)?.referrer ?? incoming.referrer,
    self_reported_source: sanitize(safeGet(localS(), SELF_REPORTED_SOURCE_KEY)),
    self_reported_source_detail: sanitize(safeGet(localS(), SELF_REPORTED_DETAIL_KEY)),
  };
}

export function readAttribution(): AttributionState {
  const sessionId = getOrCreateSourceSessionId();
  const metaIds = readMetaBrowserIds();
  const first = enrichTouchWithMetaIds(readTouch(FIRST_TOUCH_KEY) ?? {}, metaIds);
  const last = enrichTouchWithMetaIds(readTouch(LAST_TOUCH_KEY) ?? {}, metaIds);
  return {
    source_session_id: sessionId,
    first_touch: first,
    last_touch: last,
    landing_page_slug: first.landing_page_slug ?? last.landing_page_slug,
    fbclid: first.fbclid ?? last.fbclid,
    fbp: metaIds.fbp ?? first.fbp ?? last.fbp,
    fbc: metaIds.fbc ?? first.fbc ?? last.fbc,
    referrer: first.referrer ?? last.referrer,
    self_reported_source: sanitize(safeGet(localS(), SELF_REPORTED_SOURCE_KEY)),
    self_reported_source_detail: sanitize(safeGet(localS(), SELF_REPORTED_DETAIL_KEY)),
  };
}

/** ONLY for tests. */
export function __resetAttributionForTests(): void {
  try {
    localS()?.removeItem(FIRST_TOUCH_KEY);
    localS()?.removeItem(SESSION_ID_KEY);
    localS()?.removeItem(SELF_REPORTED_SOURCE_KEY);
    localS()?.removeItem(SELF_REPORTED_DETAIL_KEY);
    sessionS()?.removeItem(LAST_TOUCH_KEY);
  } catch {
    /* noop */
  }
}
