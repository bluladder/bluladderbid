import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServerPlanQuotes, type PlanQuotesInput } from './useServerPlanQuotes';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from '@/integrations/supabase/client';
const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

const okResponse = (opts: Array<{ id: string; annual: number; status?: string }>) => ({
  data: {
    status: 'ok',
    engineVersion: '1.0.0',
    ruleVersion: 3,
    options: opts.map((o) => ({
      optionId: o.id,
      status: o.status ?? 'firm',
      engineVersion: '1.0.0',
      ruleVersion: 3,
      billingCadence: 'monthly',
      frequency: 4,
      lineItems: [{ key: 'gutter_cleaning', label: 'Gutter', perVisitAmount: o.annual / 4, frequency: 4, annualAmount: o.annual }],
      frequencyAdjustment: 0,
      bundleAdjustment: 0,
      perVisitTotal: o.annual / 4,
      annualTotal: o.status && o.status !== 'firm' ? null : o.annual,
      recurringAmount: 100,
      downPayment: 200,
      estimatedDurationMinutes: null,
      missing: [],
      manualReviewReasons: [],
      prepInstructions: null,
      promotion: null,
    })),
  },
  error: null,
});

const baseInput = (sqft = 2500): PlanQuotesInput => ({
  homeDetails: { squareFootage: sqft, stories: 2, condition: 'maintenance' },
  scenarios: [{ id: 'current', additionalServices: { gutterCleaning: true }, serviceFrequencies: { gutter_cleaning: 4 } }],
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => invoke.mockReset());

describe('useServerPlanQuotes', () => {
  it('calls calculate-plan-options and exposes firm, selectable options', async () => {
    invoke.mockResolvedValue(okResponse([{ id: 'current', annual: 800 }]));
    const input = baseInput();
    const { result } = renderHook(() => useServerPlanQuotes(input, { debounceMs: 1 }));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(invoke).toHaveBeenCalledWith('calculate-plan-options', { body: input });
    expect(result.current.options['current'].annualTotal).toBe(800);
    expect(result.current.byId('current')).not.toBeNull();
  });

  it('a server failure displays no fallback price on any option', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useServerPlanQuotes(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.unavailable).toBe(true));
    expect(result.current.orderedOptions).toHaveLength(0);
    expect(result.current.byId('current')).toBeNull();
  });

  it('loading clears the previous options (no stale amount)', async () => {
    invoke.mockResolvedValueOnce(okResponse([{ id: 'current', annual: 800 }]));
    const { result, rerender } = renderHook(
      ({ inp }) => useServerPlanQuotes(inp, { debounceMs: 5 }),
      { initialProps: { inp: baseInput(2500) } },
    );
    await waitFor(() => expect(result.current.options['current']?.annualTotal).toBe(800));

    invoke.mockResolvedValueOnce(okResponse([{ id: 'current', annual: 1600 }]));
    rerender({ inp: baseInput(4000) });
    expect(result.current.phase).toBe('loading');
    expect(result.current.options['current']).toBeUndefined();
    await waitFor(() => expect(result.current.options['current']?.annualTotal).toBe(1600));
  });

  it('an obsolete batch response cannot overwrite a newer result', async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    invoke
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));

    const { result, rerender } = renderHook(
      ({ inp }) => useServerPlanQuotes(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput(2500) } },
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rerender({ inp: baseInput(4000) });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    resolveSecond(okResponse([{ id: 'current', annual: 1600 }]));
    await waitFor(() => expect(result.current.options['current']?.annualTotal).toBe(1600));
    resolveFirst(okResponse([{ id: 'current', annual: 800 }]));
    await wait(15);
    expect(result.current.options['current']?.annualTotal).toBe(1600);
  });

  it('de-duplicates identical normalized inputs', async () => {
    invoke.mockResolvedValue(okResponse([{ id: 'current', annual: 800 }]));
    const { rerender } = renderHook(
      ({ inp }) => useServerPlanQuotes(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput(2500) } },
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    rerender({ inp: baseInput(2500) });
    await wait(15);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('changing inputs invalidates and re-requests', async () => {
    invoke.mockResolvedValue(okResponse([{ id: 'current', annual: 800 }]));
    const { result, rerender } = renderHook(
      ({ inp }) => useServerPlanQuotes(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput(2500) } },
    );
    await waitFor(() => expect(result.current.options['current']?.annualTotal).toBe(800));
    rerender({ inp: baseInput(3000) });
    expect(result.current.options['current']).toBeUndefined();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
  });

  it('a manual-review option is not selectable but firm siblings remain', async () => {
    invoke.mockResolvedValue(okResponse([
      { id: 'firm', annual: 800 },
      { id: 'review', annual: 0, status: 'manual_review_required' },
    ]));
    const input: PlanQuotesInput = {
      homeDetails: { squareFootage: 2500, stories: 2, condition: 'maintenance' },
      scenarios: [
        { id: 'firm', additionalServices: { gutterCleaning: true } },
        { id: 'review', additionalServices: { houseWash: true } },
      ],
    };
    const { result } = renderHook(() => useServerPlanQuotes(input, { debounceMs: 1 }));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.byId('firm')).not.toBeNull();
    expect(result.current.byId('review')).toBeNull();
    expect(result.current.options['review'].isManualReview).toBe(true);
  });

  it('no scenarios => idle, no request', async () => {
    invoke.mockResolvedValue(okResponse([{ id: 'current', annual: 800 }]));
    const { result } = renderHook(() => useServerPlanQuotes(null, { debounceMs: 1 }));
    await wait(15);
    expect(result.current.phase).toBe('idle');
    expect(invoke).not.toHaveBeenCalled();
  });
});
