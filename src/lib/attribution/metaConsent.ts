export const META_TRACKING_CONSENT_KEY = 'bluladder_meta_tracking_consent';

export type MetaTrackingConsent = 'granted' | 'denied' | 'unknown';

export function readMetaTrackingConsent(): MetaTrackingConsent {
  if (typeof window === 'undefined') return 'unknown';
  try {
    const value = window.localStorage.getItem(META_TRACKING_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Internal integration point for the future customer-facing consent control.
 * Until that UI exists, `unknown` preserves current tracking behavior while an
 * explicit denial always fails closed.
 */
export function setMetaTrackingConsent(consent: Exclude<MetaTrackingConsent, 'unknown'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(META_TRACKING_CONSENT_KEY, consent);
  } catch {
    /* noop */
  }
}

export function isMetaTrackingDenied(): boolean {
  return readMetaTrackingConsent() === 'denied';
}

/** Testing hook. */
export function __resetMetaTrackingConsentForTests(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(META_TRACKING_CONSENT_KEY);
  } catch {
    /* noop */
  }
}
