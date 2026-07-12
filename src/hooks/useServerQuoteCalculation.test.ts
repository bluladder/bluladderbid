import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useServerQuoteCalculation } from './useServerQuoteCalculation';
import type { QuoteInput } from '@/lib/pricing/engine';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));

import { supabase } from '@/integrations/supabase/client';
const invoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

const firm = (total: number) => ({
  data: {
    status: 'firm',
    firm: true,
    total,
    subtotal: total,
    lineItems: [{ key: 'gutter_cleaning', label: 'Gutter Cleaning', amount: total }],
    discount: null,
    missing: [],
    manualReviewReasons: [],
    ruleVersion: 1,
    engineVersion: '1.0.0',
  },
  error: null,
});

const baseInput = (): QuoteInput => ({
  homeDetails: { squareFootage: 2500, stories: 2 },
  additionalServices: { gutterCleaning: true },
  discount: null,
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  invoke.mockReset();
});

describe('useServerQuoteCalculation', () => {
  it('1. customer-facing quotes call calculate-quote with the structured input', async () => {
    invoke.mockResolvedValue(firm(220));
    const input = baseInput();
    const { result } = renderHook(() => useServerQuoteCalculation(input, { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isFirm).toBe(true));
    expect(invoke).toHaveBeenCalledWith('calculate-quote', { body: input });
    expect(result.current.total).toBe(220);
    expect(result.current.ruleVersion).toBe(1);
  });

  it('2. a server failure does not display a fallback price', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useServerQuoteCalculation(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.total).toBeNull();
    expect(result.current.quote).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('2b. a thrown/network error does not display a fallback price', async () => {
    invoke.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useServerQuoteCalculation(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isUnavailable).toBe(true));
    expect(result.current.total).toBeNull();
  });

  it('3. missing square footage is surfaced, never assumed', async () => {
    invoke.mockResolvedValue({
      data: { status: 'missing_information', missing: ['squareFootage'], total: 0 },
      error: null,
    });
    const { result } = renderHook(() => useServerQuoteCalculation(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isMissingInfo).toBe(true));
    expect(result.current.total).toBeNull();
    expect(result.current.missing).toContain('squareFootage');
  });

  it('4. missing story count is surfaced, never assumed', async () => {
    invoke.mockResolvedValue({
      data: { status: 'missing_information', missing: ['stories'], total: 0 },
      error: null,
    });
    const { result } = renderHook(() => useServerQuoteCalculation(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isMissingInfo).toBe(true));
    expect(result.current.missing).toContain('stories');
    expect(result.current.total).toBeNull();
  });

  it('5. manual-review services do not display a firm price', async () => {
    invoke.mockResolvedValue({
      data: {
        status: 'manual_review_required',
        manualReviewReasons: ['commercial property'],
        total: 0,
      },
      error: null,
    });
    const { result } = renderHook(() => useServerQuoteCalculation(baseInput(), { debounceMs: 1 }));
    await waitFor(() => expect(result.current.isManualReview).toBe(true));
    expect(result.current.total).toBeNull();
    expect(result.current.manualReviewReasons.length).toBeGreaterThan(0);
  });

  it('6. loading does not display an old price', async () => {
    invoke.mockResolvedValueOnce(firm(220));
    const { result, rerender } = renderHook(
      ({ inp }) => useServerQuoteCalculation(inp, { debounceMs: 5 }),
      { initialProps: { inp: baseInput() } },
    );
    await waitFor(() => expect(result.current.total).toBe(220));

    // Change input -> the previous price must be cleared immediately.
    invoke.mockResolvedValueOnce(firm(999));
    const next = baseInput();
    next.homeDetails.squareFootage = 4000;
    rerender({ inp: next });
    expect(result.current.total).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.total).toBe(999));
  });

  it('7. an obsolete quote response cannot replace a newer result', async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    invoke
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise((r) => { resolveSecond = r; }));

    const { result, rerender } = renderHook(
      ({ inp }) => useServerQuoteCalculation(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput() } },
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));

    const next = baseInput();
    next.homeDetails.squareFootage = 4000;
    rerender({ inp: next });
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));

    // Newer (second) request resolves first.
    resolveSecond(firm(999));
    await waitFor(() => expect(result.current.total).toBe(999));
    // Older (first) request resolves late and must be ignored.
    resolveFirst(firm(111));
    await wait(15);
    expect(result.current.total).toBe(999);
  });

  it('8. identical inputs do not create unnecessary duplicate requests', async () => {
    invoke.mockResolvedValue(firm(220));
    const { rerender } = renderHook(
      ({ inp }) => useServerQuoteCalculation(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput() } },
    );
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    // Re-render with a NEW object of identical content.
    rerender({ inp: baseInput() });
    await wait(15);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('9. changing service inputs invalidates the prior quote', async () => {
    invoke.mockResolvedValue(firm(220));
    const { result, rerender } = renderHook(
      ({ inp }) => useServerQuoteCalculation(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput() } },
    );
    await waitFor(() => expect(result.current.total).toBe(220));
    invoke.mockResolvedValue(firm(500));
    const next = baseInput();
    next.additionalServices.houseWash = true;
    rerender({ inp: next });
    expect(result.current.total).toBeNull();
    await waitFor(() => expect(result.current.total).toBe(500));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('10/11. changing property details or a discount invalidates the prior quote', async () => {
    invoke.mockResolvedValue(firm(220));
    const { result, rerender } = renderHook(
      ({ inp }) => useServerQuoteCalculation(inp, { debounceMs: 1 }),
      { initialProps: { inp: baseInput() } },
    );
    await waitFor(() => expect(result.current.total).toBe(220));

    invoke.mockResolvedValue(firm(200));
    const withDiscount = baseInput();
    withDiscount.discount = { type: 'fixed', value: 20, code: 'SAVE20' };
    rerender({ inp: withDiscount });
    expect(result.current.total).toBeNull();
    await waitFor(() => expect(result.current.total).toBe(200));
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('goes idle (no request) when no input is provided', async () => {
    invoke.mockResolvedValue(firm(220));
    const { result } = renderHook(() => useServerQuoteCalculation(null, { debounceMs: 1 }));
    await wait(15);
    expect(result.current.phase).toBe('idle');
    expect(result.current.total).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});