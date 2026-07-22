import { describe, it, expect } from 'vitest';
import { computePlanPaymentBreakdown, PLAN_REMAINING_MONTHS } from './planPaymentBreakdown';

describe('computePlanPaymentBreakdown', () => {
  it.each([
    [885, 0],
    [1200, 0],
    [1497, 0],
    [2500, 0],
    [999, 250],
  ])('reconciles deposit + 11 monthly payments to annual total (annual=%s)', (annual, savings) => {
    const b = computePlanPaymentBreakdown({ annualTotal: annual, authoritativeSavings: savings });
    expect(b).not.toBeNull();
    expect(b!.depositAmount + b!.monthlyPayment * PLAN_REMAINING_MONTHS).toBe(annual);
    // Deposit stays within a couple of dollars of the 20% target.
    expect(Math.abs(b!.depositAmount - Math.round(annual * 0.2))).toBeLessThanOrEqual(11);
  });

  it('uses the authoritative bundle savings and reconciles the comparison total', () => {
    const b = computePlanPaymentBreakdown({ annualTotal: 885, authoritativeSavings: 405 });
    expect(b!.savings).toBe(405);
    expect(b!.comparisonTotal).toBe(885 + 405);
  });

  it('falls back to derived savings from a comparable one-time total', () => {
    const b = computePlanPaymentBreakdown({ annualTotal: 800, comparisonTotal: 1200 });
    expect(b!.savings).toBe(400);
  });

  it('returns null for zero or invalid annual totals', () => {
    expect(computePlanPaymentBreakdown({ annualTotal: 0 })).toBeNull();
    expect(computePlanPaymentBreakdown({ annualTotal: Number.NaN })).toBeNull();
  });
});