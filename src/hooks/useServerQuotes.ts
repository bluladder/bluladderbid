/**
 * ============================================================================
 * useServerQuotes — authoritative BATCH one-time quote service (admin tools).
 * ============================================================================
 * Fetches several one-time quotes from the SAME `calculate-quote` Edge Function
 * used by the customer UI, so administrator previews and the customer flow are
 * guaranteed to produce identical totals, line items and trace for identical
 * inputs. No local pricing math, no fallback pricing.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { QuoteInput, QuoteResult } from '@/lib/pricing/engine';

export interface QuoteRequest {
  id: string;
  input: QuoteInput | null;
}

export interface ServerQuotesState {
  loading: boolean;
  error: string | null;
  /** Firm/estimated quotes keyed by request id. Missing ids = not firm. */
  byId: Record<string, QuoteResult | null>;
  ruleVersion: number | null;
  engineVersion: string | null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function useServerQuotes(requests: QuoteRequest[]): ServerQuotesState {
  const [state, setState] = useState<ServerQuotesState>({
    loading: false,
    error: null,
    byId: {},
    ruleVersion: null,
    engineVersion: null,
  });

  const seqRef = useRef(0);
  const hash = useMemo(
    () => stableStringify(requests.map((r) => ({ id: r.id, input: r.input }))),
    [requests],
  );

  useEffect(() => {
    const active = requests.filter((r) => r.input);
    if (active.length === 0) {
      seqRef.current++;
      setState({ loading: false, error: null, byId: {}, ruleVersion: null, engineVersion: null });
      return;
    }
    const seq = ++seqRef.current;
    setState((s) => ({ ...s, loading: true, error: null }));

    (async () => {
      try {
        const results = await Promise.all(
          active.map(async (r) => {
            const { data, error } = await supabase.functions.invoke('calculate-quote', { body: r.input });
            if (error || !data || typeof data !== 'object') return { id: r.id, quote: null as QuoteResult | null };
            const res = data as QuoteResult & { status?: string };
            const ok = res.status === 'firm' || res.status === 'estimated';
            return { id: r.id, quote: ok ? res : null };
          }),
        );
        if (seq !== seqRef.current) return;
        const byId: Record<string, QuoteResult | null> = {};
        let ruleVersion: number | null = null;
        let engineVersion: string | null = null;
        for (const r of results) {
          byId[r.id] = r.quote;
          if (r.quote) {
            ruleVersion = r.quote.ruleVersion ?? ruleVersion;
            engineVersion = r.quote.engineVersion ?? engineVersion;
          }
        }
        setState({ loading: false, error: null, byId, ruleVersion, engineVersion });
      } catch {
        if (seq === seqRef.current) {
          setState({
            loading: false,
            error: 'Pricing is temporarily unavailable.',
            byId: {},
            ruleVersion: null,
            engineVersion: null,
          });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  return state;
}
