import { describe, it, expect } from 'vitest';
import { computePlanPaymentBreakdown, PLAN_REMAINING_MONTHS } from './planPaymentBreakdown';

describe('computePlanPaymentBreakdown', () => {
  it.each([885, 1200, 1497, 2500, 999, 1000, 883.33])(
    'deposit is exactly 20%% of annual, and full schedule reconciles to the cent (annual=%s)',
    (annual) => {
      const b = computePlanPaymentBreakdown({ annualTotal: annual });
      expect(b).not.toBeNull();
      const annualCents = Math.round(annual * 100 + Number.EPSILON);
      // 1) Deposit is exactly 20% rounded to the nearest cent — never a
      //    silently adjusted amount that differs from what the processor charges.
      expect(b!.depositAmountCents).toBe(Math.round(annualCents * 0.20));
      // 2) Deposit + 10 regular installments + 1 final installment reconcile
      //    exactly to the annual total in cents.
      const scheduleCents =
        b!.depositAmountCents +
        b!.monthlyPaymentCents * b!.regularPaymentCount +
        b!.finalPaymentCents;
      expect(scheduleCents).toBe(annualCents);
      expect(b!.regularPaymentCount + 1).toBe(PLAN_REMAINING_MONTHS);
      // 3) The final installment absorbs any remainder rather than the deposit.
      expect(b!.finalPaymentCents).toBeGreaterThanOrEqual(b!.monthlyPaymentCents);
    },
  );

  it('matches the owner-provided $885 reference schedule', () => {
    const b = computePlanPaymentBreakdown({ annualTotal: 885, authoritativeSavings: 405 });
    expect(b!.depositAmount).toBe(177);
    expect(b!.monthlyPayment).toBe(64.36);
    expect(b!.finalPayment).toBe(64.4);
    expect(b!.regularPaymentCount).toBe(10);
    expect(b!.hasFinalAdjustment).toBe(true);
    expect(b!.savings).toBe(405);
    expect(b!.comparisonTotal).toBe(885 + 405);
  });

  it('produces 11 equal installments when the split is even', () => {
    // $1100 -> deposit $220, remaining $880, /11 = $80 exactly.
    const b = computePlanPaymentBreakdown({ annualTotal: 1100 });
    expect(b!.depositAmount).toBe(220);
    expect(b!.monthlyPayment).toBe(80);
    expect(b!.finalPayment).toBe(80);
    expect(b!.hasFinalAdjustment).toBe(false);
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