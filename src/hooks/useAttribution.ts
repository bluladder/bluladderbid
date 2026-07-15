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
    const signature = JSON.stringify({
      s: state.source_session_id,
      f: state.first_touch,
      l: state.last_touch,
    });
    if (sentRef.current === signature) return;
    sentRef.current = signature;
    void supabase.functions
      .invoke('attribution-ingest', {
        body: {
          source_session_id: state.source_session_id,
          first_touch: state.first_touch,
          last_touch: state.last_touch,
          landing_page_slug: state.landing_page_slug,
          fbclid: state.fbclid,
          referrer: state.referrer,
        },
      })
      .catch(() => {
        /* silently ignore */
      });
  }, [state]);

  return state;
}
