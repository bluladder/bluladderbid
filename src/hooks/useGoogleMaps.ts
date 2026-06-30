import { useEffect, useState } from 'react';

const BROWSER_KEY = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY as
  | string
  | undefined;
const CHANNEL = import.meta.env.VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID as
  | string
  | undefined;

type LoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unconfigured';

// Module-level singleton so the script only ever loads once.
let loadPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (!BROWSER_KEY) return Promise.reject(new Error('unconfigured'));
  if ((window as any).google?.maps?.importLibrary) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const cbName = '__initGoogleMapsBluLadder';
    (window as any)[cbName] = () => resolve();

    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: BROWSER_KEY,
      v: 'weekly',
      loading: 'async',
      libraries: 'places',
      callback: cbName,
    });
    if (CHANNEL) params.set('channel', CHANNEL);
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Loads the Google Maps JS API (Places library) on demand using the
 * referrer-restricted browser key from the Google Maps connector.
 */
export function useGoogleMaps(): { state: LoadState; ready: boolean } {
  const [state, setState] = useState<LoadState>(BROWSER_KEY ? 'idle' : 'unconfigured');

  useEffect(() => {
    if (!BROWSER_KEY) {
      setState('unconfigured');
      return;
    }
    let cancelled = false;
    setState((s) => (s === 'ready' ? s : 'loading'));
    loadGoogleMaps()
      .then(() => !cancelled && setState('ready'))
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, ready: state === 'ready' };
}