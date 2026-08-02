import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import {
  captureAttribution,
  readAttribution,
  type AttributionState,
} from '@/lib/attribution/attribution';

/**
 * Capture whitelisted attribution params from the URL, persist them, and
 * upsert into the server attribution_events table (best-effort, non-blocking).
 */
export function useAttribution(): AttributionState {
  const [searchParams] = useSearchParams();
  const sentRef = useRef<string | null>(null);

  const state = useMemo(() => {
    if (typeof window === 'undefined') return readAttribution();
    return captureAttribution(searchParams);
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const send = (snapshot: AttributionState) => {
      const signature = JSON.stringify({
        s: snapshot.source_session_id,
        f: snapshot.first_touch,
        l: snapshot.last_touch,
      });
      if (sentRef.current === signature) return;
      sentRef.current = signature;
      void supabase.functions
        .invoke('attribution-ingest', {
          body: {
            source_session_id: snapshot.source_session_id,
            first_touch: snapshot.first_touch,
            last_touch: snapshot.last_touch,
            landing_page_slug: snapshot.landing_page_slug,
            fbclid: snapshot.fbclid,
            referrer: snapshot.referrer,
          },
        })
        .catch(() => {
          /* silently ignore */
        });
    };

    send(state);
    // Meta creates _fbp/_fbc asynchronously. Re-read once after the loader has
    // had time to set them, then send only if the attribution signature changed.
    const metaCookieTimer = window.setTimeout(() => send(readAttribution()), 1_500);
    return () => window.clearTimeout(metaCookieTimer);
  }, [state]);

  return state;
}
