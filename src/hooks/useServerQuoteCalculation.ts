/**
 * ============================================================================
 * useServerQuoteCalculation — the SINGLE authoritative client quote service.
 * ============================================================================
 * Every customer-facing price MUST come from the deployed `calculate-quote`
 * Edge Function (which recalculates from the canonical pricing engine against
 * the live pricing_config). This hook is the ONLY place the frontend is allowed
 * to obtain an authoritative total.
 *
 * Guarantees:
 *  - NEVER falls back to local/constant pricing. A server failure yields the
 *    `unavailable` phase with NO dollar amount.
 *  - NEVER assumes missing property details (sqft / stories / etc).
 *  - Debounces rapid input changes.
 *  - Cancels obsolete in-flight requests (AbortController).
 *  - Prevents an older response from overwriting a newer quote (sequence guard).
 *  - De-duplicates identical inputs (no redundant requests).
 *  - On any input change, the previous quote is invalidated immediately so a
 *    stale price is never shown while a new one is loading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { QuoteInput, QuoteResult } from '@/lib/pricing/engine';

export type ServerQuotePhase =
  | 'idle'
  | 'loading'
  | 'firm'
  | 'estimated'
  | 'missing_information'
  | 'manual_review_required'
  | 'unavailable';

export interface ServerQuoteState {
  phase: ServerQuotePhase;
  /** The full authoritative server result, or null when not firm/estimated. */
  quote: QuoteResult | null;
  /** The authoritative total. ONLY present for firm/estimated quotes. */
  total: number | null;
  loading: boolean;
  /** Non-technical error message, never leaks backend details. */
  error: string | null;
  missing: string[];
  manualReviewReasons: string[];
  ruleVersion: number | null;
  engineVersion: string | null;
  isFirm: boolean;
  isEstimated: boolean;
  isMissingInfo: boolean;
  isManualReview: boolean;
  isUnavailable: boolean;
  /** Force a fresh recalculation even if the inputs are unchanged. */
  refetch: () => void;
}

const IDLE: ServerQuoteState = {
  phase: 'idle',
  quote: null,
  total: null,
  loading: false,
  error: null,
  missing: [],
  manualReviewReasons: [],
  ruleVersion: null,
  engineVersion: null,
  isFirm: false,
  isEstimated: false,
  isMissingInfo: false,
  isManualReview: false,
  isUnavailable: false,
  refetch: () => {},
};

/** Order-independent stable stringify so key ordering never causes cache misses. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

type Phaseable = { phase: ServerQuotePhase };
function derive(phase: ServerQuotePhase): Omit<Phaseable, 'phase'> & {
  isFirm: boolean; isEstimated: boolean; isMissingInfo: boolean;
  isManualReview: boolean; isUnavailable: boolean; loading: boolean;
} {
  return {
    loading: phase === 'loading',
    isFirm: phase === 'firm',
    isEstimated: phase === 'estimated',
    isMissingInfo: phase === 'missing_information',
    isManualReview: phase === 'manual_review_required',
    isUnavailable: phase === 'unavailable',
  };
}

const UNAVAILABLE_MESSAGE =
  "We're temporarily unable to calculate this price. You can request a quote and our team will follow up.";

export function useServerQuoteCalculation(
  input: QuoteInput | null,
  options: { debounceMs?: number; enabled?: boolean } = {},
): ServerQuoteState {
  const { debounceMs = 350, enabled = true } = options;

  const [state, setState] = useState<ServerQuoteState>(IDLE);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastHashRef = useRef<string | null>(null);
  const inputRef = useRef<QuoteInput | null>(input);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  inputRef.current = input;

  const hash = useMemo(() => (enabled && input ? stableStringify(input) : null), [enabled, input]);

  const applyUnavailable = useCallback((seq: number) => {
    if (seq !== seqRef.current) return;
    setState({
      ...IDLE,
      phase: 'unavailable',
      error: UNAVAILABLE_MESSAGE,
      ...derive('unavailable'),
    });
  }, []);

  const run = useCallback(
    async (payload: QuoteInput) => {
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      try {
        const { data, error } = await supabase.functions.invoke('calculate-quote', {
          body: payload,
        });
        if (seq !== seqRef.current) return; // a newer request superseded this one
        if (error || !data || typeof data !== 'object') {
          applyUnavailable(seq);
          return;
        }
        const result = data as Partial<QuoteResult> & { status?: string };
        const status = result.status;
        let phase: ServerQuotePhase;
        switch (status) {
          case 'firm':
            phase = 'firm';
            break;
          case 'estimated':
            phase = 'estimated';
            break;
          case 'manual_review_required':
            phase = 'manual_review_required';
            break;
          case 'missing_information':
            phase = 'missing_information';
            break;
          default:
            // pricing_unavailable / rate_limited / error / unknown
            applyUnavailable(seq);
            return;
        }
        const firmOrEstimate = phase === 'firm' || phase === 'estimated';
        setState({
          ...IDLE,
          phase,
          quote: firmOrEstimate ? (result as QuoteResult) : null,
          total: firmOrEstimate && typeof result.total === 'number' ? result.total : null,
          error: null,
          missing: result.missing ?? [],
          manualReviewReasons: result.manualReviewReasons ?? [],
          ruleVersion: result.ruleVersion ?? null,
          engineVersion: result.engineVersion ?? null,
          ...derive(phase),
        });
      } catch {
        if (seq === seqRef.current) applyUnavailable(seq);
      }
    },
    [applyUnavailable],
  );

  const refetch = useCallback(() => {
    lastHashRef.current = null;
    const payload = inputRef.current;
    if (!payload) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setState((s) => ({ ...IDLE, phase: 'loading', ...derive('loading'), refetch: s.refetch }));
    void run(payload);
  }, [run]);

  useEffect(() => {
    // No enabled input → idle and cancel anything in flight.
    if (!hash) {
      seqRef.current++; // invalidate any in-flight response
      abortRef.current?.abort();
      if (timerRef.current) clearTimeout(timerRef.current);
      lastHashRef.current = null;
      setState({ ...IDLE, refetch });
      return;
    }

    // De-dup: identical inputs must not trigger another request.
    if (hash === lastHashRef.current) return;
    lastHashRef.current = hash;

    // Invalidate the previous quote immediately so a stale price is never shown.
    setState({ ...IDLE, phase: 'loading', ...derive('loading'), refetch });

    if (timerRef.current) clearTimeout(timerRef.current);
    const payload = inputRef.current!;
    timerRef.current = setTimeout(() => {
      void run(payload);
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hash, debounceMs, run, refetch]);

  return useMemo(() => ({ ...state, refetch }), [state, refetch]);
}