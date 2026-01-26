import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  preset?: string;
}

const UTM_STORAGE_KEY = 'bluladder_utm_params';
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'preset'] as const;

/**
 * Captures and persists UTM parameters from the URL.
 * Parameters are stored in sessionStorage and persist for the duration of the session.
 * New UTM params will overwrite existing ones if present in URL.
 */
export function useUtmTracking() {
  const [searchParams] = useSearchParams();

  // Extract UTM params from current URL
  const urlUtmParams = useMemo(() => {
    const params: UtmParams = {};
    UTM_KEYS.forEach((key) => {
      const value = searchParams.get(key);
      if (value) {
        params[key] = value;
      }
    });
    return params;
  }, [searchParams]);

  // Persist UTM params to sessionStorage when they appear in URL
  useEffect(() => {
    if (Object.keys(urlUtmParams).length > 0) {
      const existing = getStoredUtmParams();
      const merged = { ...existing, ...urlUtmParams };
      sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(merged));
    }
  }, [urlUtmParams]);

  return {
    /** Current UTM params from URL (if any) */
    urlUtmParams,
    /** Get all stored UTM params (merged from session) */
    getStoredUtmParams,
    /** Clear stored UTM params */
    clearUtmParams,
    /** Check if we have any UTM attribution */
    hasAttribution: () => Object.keys(getStoredUtmParams()).length > 0,
  };
}

/** Get stored UTM params from sessionStorage */
export function getStoredUtmParams(): UtmParams {
  try {
    const stored = sessionStorage.getItem(UTM_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/** Clear stored UTM params */
export function clearUtmParams(): void {
  sessionStorage.removeItem(UTM_STORAGE_KEY);
}

/** Format UTM params for display or logging */
export function formatUtmAttribution(params: UtmParams): string {
  const parts: string[] = [];
  if (params.utm_source) parts.push(`Source: ${params.utm_source}`);
  if (params.utm_medium) parts.push(`Medium: ${params.utm_medium}`);
  if (params.utm_campaign) parts.push(`Campaign: ${params.utm_campaign}`);
  if (params.utm_term) parts.push(`Term: ${params.utm_term}`);
  if (params.utm_content) parts.push(`Content: ${params.utm_content}`);
  return parts.join(' | ') || 'Direct';
}
