/**
 * ============================================================================
 * useServerPlanQuotes — the SINGLE authoritative client plan-pricing service.
 * ============================================================================
 * Every recurring / bundle / multi-option customer price MUST come from the
 * deployed `calculate-plan-options` Edge Function (which recalculates from the
 * canonical pricing engine against the live pricing_config). No plan component
 * may compute prices, frequency totals or bundle discounts locally.
 *
 * Guarantees (identical safety model to useServerQuoteCalculation):
 *  - NEVER falls back to local/constant pricing. A server failure yields the
 *    `unavailable` phase with NO dollar amounts on any option.
 *  - Debounces rapid input changes.
 *  - Cancels obsolete in-flight requests (sequence guard).
 *  - Prevents an older batch response from overwriting a newer one.
 *  - De-duplicates identical normalized inputs (no redundant requests).
 *  - On ANY input change (property, services, frequency, add-ons, bundle) the
 *    previous options are invalidated immediately — a stale price is never shown
 *    and a stale option is never selectable.
 *  - Independent options: a manual-review/missing option never hides valid ones.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type {
  EngineHomeDetails,
  PlanOptionResult,
  PlanScenario,
} from '@/lib/pricing/engine';

export interface PlanQuotesInput {
  homeDetails: EngineHomeDetails;
  scenarios: PlanScenario[];
}

export type PlanQuotesPhase = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface PlanOptionState extends PlanOptionResult {
  isFirm: boolean;
  isMissingInfo: boolean;
  isManualReview: boolean;
  /** True only for a current, server-returned firm option that may be booked. */
  isSelectable: boolean;
}

export interface ServerPlanQuotesState {
  phase: PlanQuotesPhase;
  loading: boolean;
  unavailable: boolean;
  error: string | null;
  /** Options keyed by optionId. Empty while loading / unavailable. */
  options: Record<string, PlanOptionState>;
  /** Options in request order. Empty while loading / unavailable. */
  orderedOptions: PlanOptionState[];
  ruleVersion: number | null;
  engineVersion: string | null;
  /** Look up a single option; returns null if it isn't currently firm/available. */
  byId: (id: string) => PlanOptionState | null;
  refetch: () => void;
}

const UNAVAILABLE_MESSAGE =
  "We're temporarily unable to calculate plan pricing. You can request a quote and our team will follow up.";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function decorate(o: PlanOptionResult): PlanOptionState {
  const isFirm = o.status === 'firm';
  return {
    ...o,
    isFirm,
    isMissingInfo: o.status === 'missing_information',
    isManualReview: o.status === 'manual_review_required',
    // Only a firm option with a real total is selectable/bookable.
    isSelectable: isFirm && typeof o.annualTotal === 'number',
  };
}

function makeState(partial: Partial<ServerPlanQuotesState>, refetch: () => void): ServerPlanQuotesState {
  const options = partial.options ?? {};
  const ordered = partial.orderedOptions ?? [];
  return {
    phase: partial.phase ?? 'idle',
    loading: (partial.phase ?? 'idle') === 'loading',
    unavailable: (partial.phase ?? 'idle') === 'unavailable',
    error: partial.error ?? null,
    options,
    orderedOptions: ordered,
    ruleVersion: partial.ruleVersion ?? null,
    engineVersion: partial.engineVersion ?? null,
    byId: (id: string) => {
      const opt = options[id];
      return opt && opt.isSelectable ? opt : null;
    },
    refetch,
  };
}

export function useServerPlanQuotes(
  input: PlanQuotesInput | null,
  options: { debounceMs?: number; enabled?: boolean } = {},
): ServerPlanQuotesState {
  const { debounceMs = 350, enabled = true } = options;

  const seqRef = useRef(0);
  const lastHashRef = useRef<string | null>(null);
  const inputRef = useRef<PlanQuotesInput | null>(input);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  inputRef.current = input;

  const refetchRef = useRef<() => void>(() => {});
  const [state, setState] = useState<ServerPlanQuotesState>(() =>
    makeState({ phase: 'idle' }, () => refetchRef.current()),
  );

  const hasScenarios = !!input && Array.isArray(input.scenarios) && input.scenarios.length > 0;
  const hash = useMemo(
    () => (enabled && hasScenarios ? stableStringify(input) : null),
    [enabled, hasScenarios, input],
  );

  const applyUnavailable = useCallback((seq: number) => {
    if (seq !== seqRef.current) return;
    setState(makeState({ phase: 'unavailable', error: UNAVAILABLE_MESSAGE }, () => refetchRef.current()));
  }, []);

  const run = useCallback(
    async (payload: PlanQuotesInput) => {
      const seq = ++seqRef.current;
      try {
        const { data, error } = await supabase.functions.invoke('calculate-plan-options', {
          body: payload,
        });
        if (seq !== seqRef.current) return; // superseded by a newer request
        if (error || !data || typeof data !== 'object') {
          applyUnavailable(seq);
          return;
        }
        const body = data as { status?: string; options?: PlanOptionResult[]; ruleVersion?: number; engineVersion?: string };
        if (body.status !== 'ok' || !Array.isArray(body.options)) {
          applyUnavailable(seq);
          return;
        }
        const ordered = body.options.map(decorate);
        const map: Record<string, PlanOptionState> = {};
        for (const o of ordered) map[o.optionId] = o;
        setState(
          makeState(
            {
              phase: 'ready',
              options: map,
              orderedOptions: ordered,
              ruleVersion: body.ruleVersion ?? null,
              engineVersion: body.engineVersion ?? null,
            },
            () => refetchRef.current(),
          ),
        );
      } catch {
        if (seq === seqRef.current) applyUnavailable(seq);
      }
    },
    [applyUnavailable],
  );

  const refetch = useCallback(() => {
    lastHashRef.current = null;
    const payload = inputRef.current;
    if (!payload || !payload.scenarios?.length) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    setState(makeState({ phase: 'loading' }, () => refetchRef.current()));
    void run(payload);
  }, [run]);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!hash) {
      seqRef.current++; // invalidate any in-flight response
      if (timerRef.current) clearTimeout(timerRef.current);
      lastHashRef.current = null;
      setState(makeState({ phase: 'idle' }, () => refetchRef.current()));
      return;
    }

    if (hash === lastHashRef.current) return; // de-dup identical normalized inputs
    lastHashRef.current = hash;

    // Invalidate previous options immediately — no stale price, no stale option.
    seqRef.current++;
    setState(makeState({ phase: 'loading' }, () => refetchRef.current()));

    if (timerRef.current) clearTimeout(timerRef.current);
    const payload = inputRef.current!;
    timerRef.current = setTimeout(() => void run(payload), debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [hash, debounceMs, run]);

  return state;
}
